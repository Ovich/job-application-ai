/**
 * The parity harness.
 *
 * Every stack in this directory replaces one CDK stack, and the templates in
 * `tests/baseline` are what those CDK stacks synthesised on 2026-09-09, the last day
 * `infra/` was TypeScript. This compares the two, and it does so by DIFFERENCE rather
 * than by a list of properties worth checking: the whole template is diffed, and every
 * leaf that disagrees has to be named below with the reason the conversion changed it.
 * A property nobody thought about is therefore a failure, not a silence.
 *
 * Three things keep it from passing vacuously. The resource set is compared in both
 * directions, so a template missing a resource fails and so does one that grew a
 * resource nobody declared. A CDK resource with no counterpart has to appear in
 * `scaffolding` with the reason it exists only inside CDK. And a declared difference
 * that is no longer a real difference fails too, so the excuse list cannot rot into a
 * blanket.
 */
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  coveringPrefix,
  differingPaths,
  type Json,
  readJsonTemplate,
  readYamlTemplate,
  renameLogicalIds,
  type Template,
} from "./support/cloudformation";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

interface Conversion {
  /** The stack, named as the template file and the baseline are named. */
  readonly stack: string;
  /** The readable logical id, mapped to the one CDK hashed. */
  readonly names: Record<string, string>;
  /** A CDK resource with no counterpart, mapped to the reason it had none. */
  readonly scaffolding: Record<string, string>;
  /** A leaf path, or the prefix of one, mapped to the reason the conversion changed it. */
  readonly differences: Record<string, string>;
}

/**
 * What CDK emits into every stack it synthesises and none of these keeps: the telemetry
 * resource, the bootstrap-version parameter and the rule asserting it. Named once
 * because the reason is the same in all five.
 */
const cdkPreamble = {
  CDKMetadata: "CDK's telemetry resource. It describes the library, not the system.",
} as const;

const cdkPreamblePaths = {
  AWSTemplateFormatVersion:
    "Stated in every hand-written template and in none of CDK's. It is the only version the format has ever had, and writing it is what tells a reader this file is a CloudFormation template.",
  "Parameters.BootstrapVersion":
    "The CDK bootstrap version, read from SSM by every synthesised stack. Nothing is bootstrapped any more.",
  Rules: "The assertion on that bootstrap version, emitted with it and meaningless without it.",
} as const;

const conversions: readonly Conversion[] = [
  {
    stack: "Deploy",
    names: {
      GitHubProvider: "GitHubProviderDD1D07DF",
      DeployRole: "DeployDevelopmentRole4080F27A",
      DeployRolePolicy: "DeployDevelopmentRoleDefaultPolicy4E90BCDF",
    },
    scaffolding: {
      ...cdkPreamble,
      CustomAWSCDKOpenIdConnectProviderCustomResourceProviderRole517FED65:
        "The role of CDK's OIDC custom resource. The native AWS::IAM::OIDCProvider needs no Lambda, so it needs no role (S6.5).",
      CustomAWSCDKOpenIdConnectProviderCustomResourceProviderHandlerF2C543E0:
        "The Lambda behind that custom resource, gone for the same reason.",
    },
    differences: {
      ...cdkPreamblePaths,
      "Resources.GitHubProvider.Type":
        "Custom::AWSCDKOpenIdConnectProvider becomes the native AWS::IAM::OIDCProvider (S6.5). Ref still yields the provider ARN, so the role's trust policy is unchanged.",
      "Resources.GitHubProvider.Properties.ServiceToken":
        "The custom resource's Lambda. There is no Lambda.",
      "Resources.GitHubProvider.Properties.ClientIDList":
        "CDK's custom resource spelled it ClientIDList; the native one spells it ClientIdList. Same single audience, sts.amazonaws.com.",
      "Resources.GitHubProvider.Properties.ClientIdList":
        "The same property, under the native spelling.",
      "Resources.GitHubProvider.Properties.RejectUnauthorized":
        "A flag of CDK's provider Lambda, not of IAM.",
      "Resources.GitHubProvider.Properties.CodeHash": "The hash of that Lambda's bundle.",
      "Resources.GitHubProvider.UpdateReplacePolicy":
        "CDK writes Delete on its custom resources; the native provider carries the stack default.",
      "Resources.GitHubProvider.DeletionPolicy": "The same.",
      "Resources.DeployRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals.token.actions.githubusercontent.com:sub":
        "A list rather than one string, because GitHub now issues the subject with immutable numeric ids — repo:Ovich@4007098/job-application-ai@1359469611:ref:refs/heads/main — and CDK wrote the name-only form the first deploy was refused on (2026-09-09, AccessDenied on AssumeRoleWithWebIdentity). Both forms are accepted; the id form is the stronger, a freed repository name being reusable where an id is not.",
      "Resources.DeployRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals.token.actions.githubusercontent.com:sub[0]":
        "The id form, which GitHub now sends.",
      "Resources.DeployRole.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals.token.actions.githubusercontent.com:sub[1]":
        "The name form CDK wrote, kept so a rollout still in progress or reverted cannot lock the pipeline out.",
      "Resources.DeployRolePolicy.Properties.PolicyName":
        "A readable name in place of the hashed one CDK derived from the construct path.",
      "Resources.DeployRolePolicy.Properties.PolicyDocument.Statement":
        "The pipeline no longer assumes CDK's bootstrap roles, so the rights those roles held are held here instead: CloudFormation, PassRole on the execution role, and the artefact bucket (S6.4). The migrate step's four statements are unchanged.",
      "Resources.CloudFormationExecutionRole":
        "New. CDK's bootstrap created cdk-hnb659fds-cfn-exec-role and CloudFormation acted as it; deleting CDK deletes that, and this is it, declared where a reader can see it. Keeping it separate is what keeps the pipeline's own identity narrow.",
      "Resources.ArtefactBucket":
        "New. CDK's bootstrap created cdk-hnb659fds-assets-<account>-<region> to hold the Lambda bundle; this is that bucket, owned by the project (S6.4).",
      Outputs:
        "New. The pipeline reads the artefact bucket's name from here rather than reconstructing it.",
    },
  },
  {
    stack: "Dns",
    names: {
      Zone: "ZoneA5DE4B68",
      Alerts: "Alerts91F83244",
      AlertsEmailSubscription: "Alertstigoes44gmailcomE68ABA00",
      AlertsPolicy: "AlertsPolicy425C338D",
      MonthlySpend: "MonthlySpend",
    },
    scaffolding: { ...cdkPreamble },
    differences: {
      ...cdkPreamblePaths,
      "Resources.Zone.DeletionPolicy":
        "Retain, which CDK did not write. The zone's four name servers are set by hand at the registrar: a stack operation that deletes it takes the domain off the internet until they are set again. This is the most dangerous line in the conversion and the one that defends it.",
      "Resources.Zone.UpdateReplacePolicy": "Retain, for the same reason.",
    },
  },
  {
    stack: "Cert-dev",
    names: { Certificate: "Certificate4E7ABB08" },
    scaffolding: {
      ...cdkPreamble,
      ExportsWritereucentral1E172851B74269898:
        "CDK's cross-region export writer. A certificate ARN cannot be exported across a region, so CDK wrote it into an SSM parameter in eu-central-1 from a Lambda. The pipeline now reads this stack's output and passes it to App-dev as a parameter (S6.4).",
      CustomCrossRegionExportWriterCustomResourceProviderRoleC951B1E1: "That writer's role.",
      CustomCrossRegionExportWriterCustomResourceProviderHandlerD8786E8A: "That writer's Lambda.",
    },
    differences: {
      ...cdkPreamblePaths,
      "Resources.Certificate.Properties.Tags":
        "A Name tag whose value was the construct path, Cert-dev/Certificate. It named CDK's tree, not the certificate.",
      Outputs:
        "New. The ARN the writer above used to smuggle into another region is now simply an output.",
    },
  },
  {
    stack: "Data-dev",
    names: {
      Vpc: "Vpc8378EB38",
      PublicSubnet1: "VpcpublicSubnet1Subnet2BB74ED7",
      PublicSubnet1RouteTable: "VpcpublicSubnet1RouteTable15C15F8E",
      PublicSubnet1RouteTableAssociation: "VpcpublicSubnet1RouteTableAssociation4E83B6E4",
      PublicSubnet1DefaultRoute: "VpcpublicSubnet1DefaultRouteB88F9E93",
      PublicSubnet2: "VpcpublicSubnet2SubnetE34B022A",
      PublicSubnet2RouteTable: "VpcpublicSubnet2RouteTableC5A6DF77",
      PublicSubnet2RouteTableAssociation: "VpcpublicSubnet2RouteTableAssociationCCE257FF",
      PublicSubnet2DefaultRoute: "VpcpublicSubnet2DefaultRoute732F0BEB",
      InternetGateway: "VpcIGWD7BA715C",
      InternetGatewayAttachment: "VpcVPCGWBF912B6E",
      ClusterSecurityGroup: "ClusterSecurityGroup94AE9AAE",
      ClusterParameters: "ClusterParametersB0AF7FD1",
      ClusterSubnets: "ClusterSubnetsDCFA5CB7",
      Cluster: "ClusterEB0386A7",
      ClusterWriter: "ClusterWriterA91BB273",
    },
    scaffolding: { ...cdkPreamble },
    differences: {
      ...cdkPreamblePaths,
      "Resources.Vpc.Properties.Tags":
        "A Name tag whose value was the construct path, Data-dev/Vpc.",
      "Resources.PublicSubnet1.Properties.Tags":
        "The same, plus aws-cdk:subnet-name and aws-cdk:subnet-type, which existed so CDK's own subnet selection could find the subnet again. Nothing selects subnets any more; they are named here.",
      "Resources.PublicSubnet2.Properties.Tags": "The same.",
      "Resources.PublicSubnet1RouteTable.Properties.Tags": "The same construct-path Name tag.",
      "Resources.PublicSubnet2RouteTable.Properties.Tags": "The same.",
      "Resources.InternetGateway.Properties.Tags": "The same.",
      "Outputs.ClusterResourceId":
        "The export App-dev reads, under a name a person can read. CDK called it ExportsOutputFnGetAttClusterEB0386A7DBClusterResourceId77E0EA54.",
      "Outputs.ClusterEndpointAddress": "The same, for the endpoint's address.",
      "Outputs.ClusterEndpointPort": "The same, for its port.",
      "Outputs.ExportsOutputFnGetAttClusterEB0386A7DBClusterResourceId77E0EA54":
        "Replaced by Outputs.ClusterResourceId above.",
      "Outputs.ExportsOutputFnGetAttClusterEB0386A7EndpointAddress0B87592A":
        "Replaced by Outputs.ClusterEndpointAddress above.",
      "Outputs.ExportsOutputFnGetAttClusterEB0386A7EndpointPortC64D6DE0":
        "Replaced by Outputs.ClusterEndpointPort above.",
    },
  },
  {
    stack: "App-dev",
    names: {
      ApiLogs: "ApiLogs3D05D88B",
      ApiRole: "ApiServiceRole1BD550DA",
      ApiRolePolicy: "ApiServiceRoleDefaultPolicyB24862FE",
      Api: "ApiF70053CD",
      ApiFunctionUrl: "ApiFunctionUrl46E4ABDE",
      WebBucket: "WebBucket12880F5B",
      WebBucketPolicy: "WebBucketPolicy95D08FAA",
      WebOriginAccessControl: "DistributionOrigin1S3OriginAccessControlEB606076",
      ApiOriginAccessControl: "DistributionOrigin2FunctionUrlOriginAccessControlAC8EE0B1",
      ApiInvokeFromDistribution:
        "DistributionOrigin2InvokeFromApiForAppdevDistributionOrigin24AF7524C878ACE41",
      Distribution: "Distribution830FAC52",
      AliasRecord: "AliasRecord851000D2",
    },
    scaffolding: {
      ...cdkPreamble,
      WebBucketAutoDeleteObjectsCustomResource9C1A079F:
        "CDK's autoDeleteObjects: a Lambda that empties the bucket so the stack can delete it. The pipeline's s3 sync --delete keeps it free of stale objects, and nothing deletes this stack automatically.",
      CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092: "That Lambda's role.",
      CustomS3AutoDeleteObjectsCustomResourceProviderHandler9D90184F: "That Lambda.",
      WebDeploymentAwsCliLayer79C1EFEA:
        "A layer holding the AWS CLI so that CDK's BucketDeployment Lambda could run it. The pipeline runs the CLI directly (S6.4).",
      WebDeploymentCustomResource08EEC474:
        "BucketDeployment itself: a custom resource that unzipped the web bundle into the bucket and invalidated the distribution. Both are steps of the workflow now.",
      CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756CServiceRole89A01265:
        "That deployment Lambda's role.",
      CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756CServiceRoleDefaultPolicy88902FDF:
        "That role's policy.",
      CustomCDKBucketDeployment8693BB64968944B69AAFB0CC9EB8756C81C01536: "That deployment Lambda.",
      ExportsReader8B249524:
        "CDK's cross-region export reader, the other half of Cert-dev's writer. The certificate ARN is a stack parameter now.",
      CustomCrossRegionExportReaderCustomResourceProviderRole10531BBD: "That reader's role.",
      CustomCrossRegionExportReaderCustomResourceProviderHandler46647B68: "That reader's Lambda.",
    },
    differences: {
      ...cdkPreamblePaths,
      "Parameters.ApiArtefactKey":
        "New. esbuild bundles the function in the pipeline and uploads it; the key of that object is what the stack is told (S6.4). CDK computed it at synth time from a content hash.",
      "Parameters.CertificateArn":
        "New. Read from Cert-dev's output by the pipeline, in place of the cross-region reader.",
      "Resources.Api.DependsOn":
        "CDK named both the role and its policy. The role is already ordered ahead of the function by the Fn::GetAtt on its ARN, so naming it again says nothing; cfn-lint reports the redundancy as W3005.",
      "Resources.Api.Properties.Code.S3Bucket":
        "The project's artefact bucket in place of CDK's bootstrap asset bucket.",
      "Resources.Api.Properties.Code.S3Key":
        "The parameter above in place of the synth-time content hash.",
      "Resources.Api.Properties.Environment.Variables.DATABASE_HOST":
        "The same import from Data-dev, under the export's readable name.",
      "Resources.Api.Properties.Environment.Variables.DATABASE_PORT": "The same.",
      "Resources.ApiRolePolicy.Properties.PolicyName":
        "A readable name in place of the hashed one.",
      "Resources.ApiRolePolicy.Properties.PolicyDocument.Statement[0].Resource":
        "The same ARN, built from Data-dev's renamed export.",
      "Resources.WebBucket.Properties.BucketName":
        "Named rather than generated. The Deploy stack grants the pipeline the right to sync into this bucket, and an IAM policy in another stack cannot name a bucket CloudFormation has not invented yet.",
      "Resources.WebBucket.Properties.Tags":
        "aws-cdk:auto-delete-objects and aws-cdk:cr-owned, which told the custom resource above that it owned this bucket. There is no custom resource.",
      "Resources.WebBucketPolicy.Properties.PolicyDocument.Statement[1]":
        "The grant to the auto-delete Lambda's role, which no longer exists. Removing it moves the grant to CloudFront up from index 2 to index 1, so both indices read as changed; the grant itself is unchanged, and the invariant test asserts it names one distribution. Index 0, the deny on insecure transport, is compared as before.",
      "Resources.WebBucketPolicy.Properties.PolicyDocument.Statement[2]":
        "The same removal, seen from the other end: there is no third statement any more.",
      "Resources.WebOriginAccessControl.Properties.OriginAccessControlConfig.Name":
        "A readable name in place of one CDK hashed from the construct path.",
      "Resources.ApiOriginAccessControl.Properties.OriginAccessControlConfig.Name": "The same.",
      "Resources.Distribution.Properties.DistributionConfig.Origins[0].Id":
        "Origin ids are chosen, not derived. AppdevDistributionOrigin174E7F862 said nothing about which origin it was.",
      "Resources.Distribution.Properties.DistributionConfig.Origins[1].Id": "The same.",
      "Resources.Distribution.Properties.DistributionConfig.DefaultCacheBehavior.TargetOriginId":
        "Follows the origin id above.",
      "Resources.Distribution.Properties.DistributionConfig.CacheBehaviors[0].TargetOriginId":
        "Follows the origin id above.",
      "Resources.Distribution.Properties.DistributionConfig.ViewerCertificate.AcmCertificateArn":
        "The CertificateArn parameter in place of a Fn::GetAtt on the cross-region reader.",
      "Resources.AliasRecord.Properties.AliasTarget.HostedZoneId":
        "Z2FDTNDATAQYW2, written out. CDK emitted a Mappings section of one entry per partition to look up a constant; this deployment has one partition.",
      Mappings: "That partition map, which nothing reads any more.",
      "Outputs.DistributionId":
        "New. The pipeline invalidates /index.html after the sync, which is what BucketDeployment did.",
      "Outputs.WebBucketName": "New. The pipeline syncs the bundle into it.",
    },
  },
];

/** The baseline, renamed into the readable ids, so a reported path names the YAML. */
const baselineOf = (conversion: Conversion): Template => {
  const inverse = Object.fromEntries(
    Object.entries(conversion.names).map(([readable, hashed]) => [hashed, readable]),
  );
  return renameLogicalIds(
    readJsonTemplate(here(`./baseline/${conversion.stack}.cdk.json`)),
    inverse,
  );
};

/**
 * The hand-written template. Passed through the same renaming as the baseline, with
 * nothing to rename, so that `DependsOn` written as one name and `DependsOn` written as
 * a list of one compare equal — CloudFormation accepts both and means the same thing.
 */
const yamlOf = (conversion: Conversion): Template =>
  renameLogicalIds(readYamlTemplate(here(`../${conversion.stack}.yaml`)), {});

/**
 * The baseline with the CDK-only resources taken out, which is what the YAML replaces.
 *
 * Resource `Metadata` goes with them where it is CDK's own: `aws:cdk:path` names the
 * construct that produced the resource and `aws:asset:*` names the staged asset, and
 * both describe the generator rather than the deployed resource. Metadata a person
 * wrote would not match these prefixes and is compared like anything else.
 */
const withoutScaffolding = (template: Template, conversion: Conversion): Template => ({
  ...template,
  Resources: Object.fromEntries(
    Object.entries(template.Resources)
      .filter(([id]) => !(id in conversion.scaffolding))
      .map(([id, resource]) => {
        const metadata = Object.entries((resource.Metadata ?? {}) as Record<string, Json>).filter(
          ([key]) => !/^aws:(cdk|asset):/.test(key),
        );
        const { Metadata: _cdk, ...rest } = resource;
        return [
          id,
          metadata.length === 0 ? rest : { ...rest, Metadata: Object.fromEntries(metadata) },
        ];
      }),
  ),
});

describe("the harness itself", () => {
  it("has a baseline for every stack, and a stack for every baseline", () => {
    const baselines = readdirSync(here("./baseline"))
      .filter((name) => name.endsWith(".cdk.json"))
      .map((name) => name.replace(".cdk.json", ""))
      .sort();
    expect(baselines).toEqual(conversions.map((conversion) => conversion.stack).sort());
  });

  it("compares baselines that have resources in them", () => {
    for (const conversion of conversions) {
      const baseline = readJsonTemplate(here(`./baseline/${conversion.stack}.cdk.json`));
      expect(Object.keys(baseline.Resources).length).toBeGreaterThan(1);
    }
  });
});

describe.each(conversions.map((conversion) => [conversion.stack, conversion] as const))(
  "%s",
  (_stack, conversion) => {
    it("names a counterpart for every resource CDK deployed, and nothing else", () => {
      const expected = Object.keys(
        withoutScaffolding(baselineOf(conversion), conversion).Resources,
      );
      expect(new Set(Object.keys(conversion.names))).toEqual(new Set(expected));
    });

    it("declares no scaffolding CDK did not emit", () => {
      const baseline = readJsonTemplate(here(`./baseline/${conversion.stack}.cdk.json`));
      const absent = Object.keys(conversion.scaffolding).filter(
        (id) => !(id in baseline.Resources),
      );
      expect(absent).toEqual([]);
    });

    it("holds the same set of resources as the CDK stack", () => {
      const baseline = withoutScaffolding(baselineOf(conversion), conversion);
      const yaml = yamlOf(conversion);
      const additions = Object.keys(conversion.differences).filter((path) =>
        path.startsWith("Resources."),
      );
      const extra = Object.keys(yaml.Resources).filter(
        (id) => !(id in baseline.Resources) && !additions.includes(`Resources.${id}`),
      );
      const missing = Object.keys(baseline.Resources).filter((id) => !(id in yaml.Resources));
      expect({ extra, missing }).toEqual({ extra: [], missing: [] });
    });

    it("keeps every resource's type", () => {
      const baseline = withoutScaffolding(baselineOf(conversion), conversion);
      const yaml = yamlOf(conversion);
      const prefixes = Object.keys(conversion.differences);
      const differing = Object.entries(baseline.Resources)
        .filter(([id, resource]) => yaml.Resources[id]?.Type !== resource.Type)
        .map(([id]) => `Resources.${id}.Type`)
        .filter((path) => coveringPrefix(path, prefixes) === undefined);
      expect(differing).toEqual([]);
    });

    it("differs from the CDK stack only where the conversion says it does", () => {
      const baseline = withoutScaffolding(baselineOf(conversion), conversion);
      const yaml = yamlOf(conversion);
      const prefixes = Object.keys(conversion.differences);
      const undeclared = differingPaths(
        baseline as unknown as Json,
        yaml as unknown as Json,
      ).filter((path) => coveringPrefix(path, prefixes) === undefined);
      expect(undeclared).toEqual([]);
    });

    it("declares no difference that is not one", () => {
      const baseline = withoutScaffolding(baselineOf(conversion), conversion);
      const yaml = yamlOf(conversion);
      const differing = differingPaths(baseline as unknown as Json, yaml as unknown as Json);
      const stale = Object.keys(conversion.differences).filter(
        (prefix) => !differing.some((path) => coveringPrefix(path, [prefix]) !== undefined),
      );
      expect(stale).toEqual([]);
    });
  },
);
