/**
 * The properties that are not preferences.
 *
 * Each of these was one line of CDK — `natGateways: 0`, `compress: false` — and each is
 * a decision recorded in the foundation that a later edit could undo without anything
 * noticing. They are the reason rule 17 exists
 * and the reason F15 holds, and until this file they were defended by nobody: `infra/`
 * had no tests, and CI never so much as synthesised a template.
 *
 * A test here names the invariant, not the property, so a failure reads as the decision
 * that was broken.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type Json, leaves, readYamlTemplate, type Template } from "./support/cloudformation";

const infra = (relative: string) => fileURLToPath(new URL(`../${relative}`, import.meta.url));

/**
 * Every template in `infra/`, found rather than listed, so a stack added later is
 * covered by these without anybody remembering to add it. Dot-files are the tools'
 * configuration, not templates.
 */
const templates: readonly (readonly [string, Template])[] = readdirSync(infra("."))
  .filter((name) => name.endsWith(".yaml") && !name.startsWith("."))
  .map((name) => [name, readYamlTemplate(infra(name))] as const);

const typesIn = (template: Template): string[] =>
  Object.values(template.Resources).map((resource) => resource.Type);

const resource = (stack: string, id: string) => {
  const template = templates.find(([name]) => name === `${stack}.yaml`)?.[1];
  if (template === undefined) throw new Error(`${stack}.yaml is missing`);
  const found = template.Resources[id];
  if (found === undefined) throw new Error(`${stack}.yaml has no resource ${id}`);
  return found;
};

/** A leaf of a resource, by path, so an assertion can name what it is asserting. */
const at = (stack: string, id: string, path: string): Json | undefined =>
  leaves(resource(stack, id) as unknown as Json).get(path);

describe("the templates are all here", () => {
  it("finds the four stacks", () => {
    expect(templates.map(([name]) => name).sort()).toEqual([
      "App-dev.yaml",
      "Cert-dev.yaml",
      "Deploy.yaml",
      "Dns.yaml",
    ]);
  });
});

describe("the cost posture (rule 17, F15)", () => {
  it("has no NAT gateway anywhere, which would be about CHF 35 a month before any traffic", () => {
    for (const [name, template] of templates) {
      expect([name, typesIn(template).filter((type) => type === "AWS::EC2::NatGateway")]).toEqual([
        name,
        [],
      ]);
    }
  });

  it("has no API Gateway anywhere: the API is a function URL behind CloudFront", () => {
    for (const [name, template] of templates) {
      expect([
        name,
        typesIn(template).filter((type) => type.startsWith("AWS::ApiGateway")),
      ]).toEqual([name, []]);
    }
  });

  it("has no RDS proxy anywhere, which is always-on capacity in front of a database", () => {
    for (const [name, template] of templates) {
      expect([name, typesIn(template).filter((type) => type === "AWS::RDS::DBProxy")]).toEqual([
        name,
        [],
      ]);
    }
  });

  it("keeps the function outside every VPC, which is what makes the NAT gateway unnecessary", () => {
    const inTheVpc = [...leaves(resource("App-dev", "Api") as unknown as Json).keys()].filter(
      (path) => path.startsWith("Properties.VpcConfig"),
    );
    expect(inTheVpc).toEqual([]);
  });
});

describe("the stream (D16, ID9)", () => {
  it("does not compress the /api/* behaviour, which is what buffers a stream to its end", () => {
    const behaviour = at(
      "App-dev",
      "Distribution",
      "Properties.DistributionConfig.CacheBehaviors[0].PathPattern",
    );
    expect(behaviour).toBe("/api/*");
    expect(
      at("App-dev", "Distribution", "Properties.DistributionConfig.CacheBehaviors[0].Compress"),
    ).toBe(false);
  });

  it("invokes the function in response-streaming mode", () => {
    expect(at("App-dev", "ApiFunctionUrl", "Properties.InvokeMode")).toBe("RESPONSE_STREAM");
  });
});

describe("the front door (F10)", () => {
  it("accepts nothing at the function URL that is not a signed request", () => {
    expect(at("App-dev", "ApiFunctionUrl", "Properties.AuthType")).toBe("AWS_IAM");
  });

  it("lets one distribution, and only that one, read the web bucket", () => {
    const grant = leaves(resource("App-dev", "WebBucketPolicy") as unknown as Json);
    const statement = "Properties.PolicyDocument.Statement[1]";
    expect({
      to: grant.get(`${statement}.Principal.Service`),
      may: grant.get(`${statement}.Action`),
      onlyWhen: grant.get(`${statement}.Condition.StringEquals.AWS:SourceArn.Fn::Join[1][5].Ref`),
    }).toEqual({
      to: "cloudfront.amazonaws.com",
      may: "s3:GetObject",
      onlyWhen: "Distribution",
    });
  });
});

describe("an API error reaches the browser as an error (S9.3)", () => {
  it("maps only the 403 a bucket answers for a missing key to the page, so a 404 from the API passes through", () => {
    // CustomErrorResponses are distribution-wide, so the SPA fallback cannot be scoped
    // to the web behaviour. What keeps the two apart is which codes are mapped: a bucket
    // behind origin access control answers 403, never 404, for a key it does not hold,
    // and the API answers 404, never 403, for a route it does not have. Mapping 404 as
    // well turned `GET /api/<unknown>` into the page with status 200, which is what
    // `e2e/health.spec.ts` now asks of the deployed distribution on every merge.
    const mapped = [...leaves(resource("App-dev", "Distribution") as unknown as Json)].filter(
      ([path]) => /CustomErrorResponses\[\d+\]\.ErrorCode$/.test(path),
    );
    expect(mapped.map(([, code]) => code)).toEqual([403]);
    expect(
      at(
        "App-dev",
        "Distribution",
        "Properties.DistributionConfig.CustomErrorResponses[0].ResponsePagePath",
      ),
    ).toBe("/index.html");
    expect(
      at(
        "App-dev",
        "Distribution",
        "Properties.DistributionConfig.CustomErrorResponses[0].ResponseCode",
      ),
    ).toBe(200);
  });
});

describe("the zone that cannot be recreated", () => {
  it("survives the deletion of the stack that declares it", () => {
    expect({
      onDelete: resource("Dns", "Zone").DeletionPolicy,
      onReplace: resource("Dns", "Zone").UpdateReplacePolicy,
    }).toEqual({ onDelete: "Retain", onReplace: "Retain" });
  });
});

describe("the database that is no longer AWS's (D19, S7.5)", () => {
  it("leaves the application importing nothing from the data stack, which is what makes that stack deletable", () => {
    const imported = [...leaves(readYamlTemplate(infra("App-dev.yaml")) as unknown as Json)]
      .filter(([path]) => path.endsWith("Fn::ImportValue"))
      .map(([path, value]) => `${path} = ${JSON.stringify(value)}`);
    expect(imported).toEqual([]);
  });

  it("hands the function its connection string as a Secrets Manager reference, never as a literal (rule 12)", () => {
    expect(at("App-dev", "Api", "Properties.Environment.Variables.DATABASE_URL")).toMatch(
      /^\{\{resolve:secretsmanager:jobapp\/dev\/database-url:SecretString\}\}$/,
    );
  });

  it("grants the function no right on any database, because there is no AWS database to grant one on", () => {
    const granted = [...leaves(readYamlTemplate(infra("App-dev.yaml")) as unknown as Json)]
      .filter(([, value]) => typeof value === "string" && value.startsWith("rds-db:"))
      .map(([path]) => path);
    expect(granted).toEqual([]);
  });
});
