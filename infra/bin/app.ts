#!/usr/bin/env tsx
// The CDK application. Two stacks are created once for the whole project — the
// deployment identity GitHub Actions acts as, and the DNS zone with the spend alarm —
// and three exist per environment. Only `dev` is deployed in this increment; production
// is a second set of the same three, which is what ID8 means by a deployment rather
// than a rewrite.
import { fileURLToPath } from "node:url";
import { App } from "aws-cdk-lib";
import { AppStack } from "../lib/app-stack";
import { CertStack } from "../lib/cert-stack";
import { DataStack } from "../lib/data-stack";
import { DeployStack } from "../lib/deploy-stack";
import { DnsStack } from "../lib/dns-stack";

// The account is not read from the ambient credentials on purpose. An environment-
// agnostic stack would deploy wherever the shell happens to point, which is how a
// resource ends up in the wrong account and is discovered by its bill.
const account = "917993967998";
const region = "eu-central-1";
const env = { account, region };
// CloudFront reads its certificate from Virginia and from nowhere else, whatever region
// serves the traffic.
const certificateEnv = { account, region: "us-east-1" };

const domainName = "job-application.app";
// Created by `Dns`. Stated here rather than imported because a CloudFormation export
// cannot cross a region and a context lookup would need credentials at synth time,
// which would make a laptop's `cdk synth` differ from the pipeline's.
const hostedZoneId = "Z01268721BDDLWGJVLJS8";

/** Paths, resolved from this file so the CDK app is independent of the shell's cwd. */
const fromRepositoryRoot = (relative: string) =>
  fileURLToPath(new URL(`../../${relative}`, import.meta.url));

const app = new App();

new DeployStack(app, "Deploy", {
  env,
  description: "GitHub OIDC provider and the deployment role. Deployed once, from a laptop.",
  githubOwner: "Ovich",
  githubRepository: "job-application-ai",
});

new DnsStack(app, "Dns", {
  env,
  description: "The hosted zone for job-application.app, the alert topic and the spend alarm.",
  domainName,
  alertEmail: "tigoes44@gmail.com",
  monthlyBudget: 20,
});

const developmentDomain = `dev.${domainName}`;
const databaseName = "jobapp";
/** The role the function authenticates as. Created by the pipeline, with `rds_iam`. */
const databaseUser = "api";

const certificate = new CertStack(app, "Cert-dev", {
  env: certificateEnv,
  crossRegionReferences: true,
  description: "The development certificate. In us-east-1 because CloudFront reads it there.",
  domainName: developmentDomain,
  hostedZoneId,
  hostedZoneName: domainName,
});

const data = new DataStack(app, "Data-dev", {
  env,
  description: "The development network and Aurora Serverless v2 cluster. Holds the state.",
  databaseName,
  masterUsername: "jobapp_root",
});

const application = new AppStack(app, "App-dev", {
  env,
  crossRegionReferences: true,
  description: "The development API, web bundle and distribution. Rebuildable from the repository.",
  domainName: developmentDomain,
  hostedZoneId,
  hostedZoneName: domainName,
  certificateArn: certificate.certificateArn,
  cluster: data.cluster,
  databaseName,
  databaseUser,
  webBundlePath: fromRepositoryRoot("apps/web/dist/web/browser"),
  apiEntryPath: fromRepositoryRoot("apps/api/src/lambda.ts"),
});

// Stated rather than left to the reference: `App-dev` reads the cluster's endpoint, so
// CloudFormation already knows, but the certificate crosses a region and is resolved by
// a custom resource that would otherwise let the two deploy in either order.
application.addStackDependency(certificate);
application.addStackDependency(data);
