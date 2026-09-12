/**
 * The properties that are not preferences.
 *
 * Each of these was one line of CDK — `natGateways: 0`, `compress: false` — and each is
 * a decision recorded in the foundation that a later edit could undo without anything
 * noticing. They are the reason the cost posture exists
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

describe("the cost posture (F15)", () => {
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

/**
 * Where an uploaded document lives (ID116, criterion 3).
 *
 * One bucket per environment, added by the slice that needs it so that dev never has a
 * function pointing at a bucket that does not exist. Everything here is a decision: the
 * bucket is private and answers nobody but the function; the function may put, get and
 * delete under `u/` and nowhere else, so a bug in a handler cannot reach an object that
 * is not a person's own document; and the name reaches the function through the
 * template rather than through a guess.
 */
describe("the documents bucket (ID116)", () => {
  it("blocks every public route into it, as the web bucket already does", () => {
    expect({
      acls: at(
        "App-dev",
        "DocumentsBucket",
        "Properties.PublicAccessBlockConfiguration.BlockPublicAcls",
      ),
      policy: at(
        "App-dev",
        "DocumentsBucket",
        "Properties.PublicAccessBlockConfiguration.BlockPublicPolicy",
      ),
      ignoreAcls: at(
        "App-dev",
        "DocumentsBucket",
        "Properties.PublicAccessBlockConfiguration.IgnorePublicAcls",
      ),
      restrict: at(
        "App-dev",
        "DocumentsBucket",
        "Properties.PublicAccessBlockConfiguration.RestrictPublicBuckets",
      ),
    }).toEqual({ acls: true, policy: true, ignoreAcls: true, restrict: true });
  });

  it("is not an origin of the distribution, so nothing reaches a document but the function", () => {
    const origins = [...leaves(resource("App-dev", "Distribution") as unknown as Json)]
      .filter(([path]) => /Origins\[\d+\]\.DomainName/.test(path))
      .map(([, value]) => JSON.stringify(value));
    expect(origins.filter((origin) => origin.includes("DocumentsBucket"))).toEqual([]);
  });

  it("lets the function put, get and delete, and nothing else", () => {
    const granted = [...leaves(resource("App-dev", "ApiRole") as unknown as Json)]
      .filter(([path]) => path.startsWith("Properties.Policies"))
      .filter(([path]) => /\.Action(\[\d+\])?$/.test(path))
      .map(([, action]) => action);
    expect(granted).toEqual(["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]);
  });

  /**
   * The prefix, and it is the whole of the key invariant seen from the cloud's side.
   * `keyFor` is the only thing in the API that composes a key, and this is what makes a
   * key composed any other way unable to reach an object at all.
   */
  it("grants those three on the u/ prefix only, never on the bucket whole", () => {
    const statement = "Properties.Policies[0].PolicyDocument.Statement[0]";
    expect({
      bucket: [
        at("App-dev", "ApiRole", `${statement}.Resource.Fn::Join[1][0].Fn::GetAtt[0]`),
        at("App-dev", "ApiRole", `${statement}.Resource.Fn::Join[1][0].Fn::GetAtt[1]`),
      ],
      thenThePrefix: at("App-dev", "ApiRole", `${statement}.Resource.Fn::Join[1][1]`),
    }).toEqual({ bucket: ["DocumentsBucket", "Arn"], thenThePrefix: "/u/*" });
  });

  it("hands the function the bucket as one URL whose scheme is the implementation", () => {
    expect(at("App-dev", "Api", "Properties.Environment.Variables.STORAGE_URL.Fn::Sub")).toBe(
      "s3://${DocumentsBucket}",
    );
  });
});

/**
 * What the discriminated union used to guarantee, and what guarantees it now (S7.2,
 * criterion 11).
 *
 * `env.ts` was a union on `APP_RUNTIME` whose cloud branch had no defaults, so a
 * function whose configuration was half set failed its cold start naming the field
 * rather than answering requests against a database on its own loopback. The flat
 * schema the person asked for is strictly weaker on its own: every value below has a
 * default a laptop runs on, and a deployed function given none of them would come up
 * happily against `localhost:5432` and a directory on a container's disk.
 *
 * So the guarantee moved here rather than being given up. The template is where the
 * deployed configuration actually lives, this test reads the template, and it fails in
 * CI on the pull request rather than at a cold start nobody is watching.
 */
describe("what the cloud must be told, because the schema now defaults it (S7.2)", () => {
  /**
   * Every value whose local default would be wrong in the cloud. Each is written out
   * rather than derived, because what makes this test worth anything is that a person
   * had to decide a name belongs on the list — a list computed from the schema would
   * grow a new name silently, which is the failure mode it exists to prevent.
   */
  const mustBeSet = ["DATABASE_URL", "STORAGE_URL", "APP_URL"] as const;

  /** The names the template actually sets, whether as a literal or through an intrinsic. */
  const set = new Set(
    [...leaves(resource("App-dev", "Api") as unknown as Json).keys()]
      .map((path) => /^Properties\.Environment\.Variables\.([^.[]+)/.exec(path)?.[1])
      .filter((name) => name !== undefined),
  );

  it.each(mustBeSet)(
    "sets %s explicitly, rather than letting the laptop's default stand",
    (name) => {
      expect([name, set.has(name)]).toEqual([name, true]);
    },
  );
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

  it("hands the function its connection string as a Secrets Manager reference, never as a literal", () => {
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

/**
 * What the function is given to authenticate with (ID60, ID71, D19), and how.
 *
 * Every one of these is a secret except the address, and the pattern is the connection
 * string's: a dynamic reference CloudFormation resolves while it applies the stack, so
 * the function needs no right on Secrets Manager and makes no call at cold start. What
 * this seam can see is that nothing secret is written out and nothing secret travels as
 * a stack parameter, where it would be visible in the console and in every event of
 * every deploy. Whether the entry exists in the account, and whether its value is right,
 * only a deploy can say.
 */
describe("what the function signs people in with (ID60, ID71)", () => {
  /**
   * The seven the library needs: the variable the function reads, and the key inside
   * `jobapp/dev/auth` it is resolved from. The two spellings differ and neither is free
   * — the variable is `env.ts`'s, the key is the entry's as the person created it
   * (ID100) — so each pair is written out and asserted whole. A pattern over the key
   * would pass on any spelling, which is exactly the failure this pins: a key that does
   * not exist resolves to nothing and fails `aws cloudformation deploy`, not a test.
   */
  const secretValues = [
    ["GOOGLE_CLIENT_ID", "googleClientId"],
    ["GOOGLE_CLIENT_SECRET", "googleClientSecret"],
    ["MICROSOFT_CLIENT_ID", "microsoftClientId"],
    ["MICROSOFT_CLIENT_SECRET", "microsoftClientSecret"],
    ["LINKEDIN_CLIENT_ID", "linkedinClientId"],
    ["LINKEDIN_CLIENT_SECRET", "linkedinClientSecret"],
    ["BETTER_AUTH_SECRET", "betterAuthSecret"],
  ] as const;

  it.each(secretValues)(
    "hands the function %s, resolved from the entry's own key %s",
    (name, key) => {
      expect(at("App-dev", "Api", `Properties.Environment.Variables.${name}`)).toBe(
        `{{resolve:secretsmanager:jobapp/dev/auth:SecretString:${key}}}`,
      );
    },
  );

  it("writes the app's address plainly, because it is not a secret", () => {
    expect(at("App-dev", "Api", "Properties.Environment.Variables.APP_URL")).toBe(
      "https://dev.job-application.app",
    );
  });

  /**
   * A parameter is not a hiding place: its value is shown in the console, in
   * `describe-stacks`, and in the command the pipeline runs. Nothing secret may travel
   * that way, which is what makes the dynamic reference the only route.
   */
  it("takes no provider value and no secret as a stack parameter", () => {
    const parameters = Object.keys(readYamlTemplate(infra("App-dev.yaml")).Parameters ?? {});
    expect(parameters.filter((name) => /client|secret|auth/i.test(name))).toEqual([]);
  });

  it("writes no provider id, no client secret and no auth secret as a literal", () => {
    const written = [...leaves(resource("App-dev", "Api") as unknown as Json)]
      .filter(([path]) => secretValues.some((name) => path.endsWith(`.${name}`)))
      .filter(([, value]) => typeof value === "string" && !value.startsWith("{{resolve:"))
      .map(([path]) => path);
    expect(written).toEqual([]);
  });

  /**
   * The deploy role's rights grow by one secret and no further (G3): CloudFormation
   * resolves the template's references with the caller's credentials, so the identity
   * that applies `App-dev` must be able to read this entry, and the end-to-end check
   * that signs a person in on the deployed address reads the same one (ID100, ID101).
   * Named down to the secret, so the pipeline's rights do not grow with the account's.
   */
  it("lets the deploy role read the two secrets it is named for, and no others", () => {
    const policy = leaves(resource("Deploy", "DeployRolePolicy") as unknown as Json);
    const allowed = [...policy]
      .filter(
        ([, value]) => typeof value === "string" && value.startsWith("arn:aws:secretsmanager"),
      )
      .map(([, value]) => String(value).replace(/^arn:aws:secretsmanager:[^:]*:\d+:secret:/, ""));
    expect(allowed.sort()).toEqual(["jobapp/dev/auth-*", "jobapp/dev/database-url-*"]);
  });
});

/**
 * The cookie's road (D5, criterion 10). The session cookie reaches the function and
 * comes back through this behaviour with no infrastructure change, and that claim rests
 * on three properties of the `/api/*` behaviour: every viewer header but Host is
 * forwarded, so `Cookie` travels; caching is disabled, and CloudFront strips
 * `Set-Cookie` only from a response it may cache; and nothing is compressed.
 *
 * The behaviour is deliberately untouched by SL5. These read it so that a later edit
 * cannot quietly take the road away.
 */
describe("the session cookie's road (D5)", () => {
  const behaviour = (property: string) =>
    at("App-dev", "Distribution", `Properties.DistributionConfig.CacheBehaviors[0].${property}`);

  it("forwards every viewer header but Host to the function, which is how a Cookie travels", () => {
    expect(behaviour("PathPattern")).toBe("/api/*");
    // The managed AllViewerExceptHostHeader policy.
    expect(behaviour("OriginRequestPolicyId")).toBe("b689b0a8-53d0-40ab-baf2-68738e2966ac");
  });

  it("caches nothing on that behaviour, which is what lets Set-Cookie back through", () => {
    // The managed CachingDisabled policy.
    expect(behaviour("CachePolicyId")).toBe("4135ea2d-6df8-44a3-9df3-4b5a84be39ad");
  });

  it("compresses nothing on that behaviour", () => {
    expect(behaviour("Compress")).toBe(false);
  });
});
