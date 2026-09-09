#!/usr/bin/env tsx
// The CDK application. Two stacks exist today, both of them created once for the whole
// project rather than per environment: the deployment identity that lets GitHub Actions
// act on this account, and the DNS zone with the spend alarm. The per-environment
// stacks (Data, App, Cert) arrive with S2.4.
import { App } from "aws-cdk-lib";
import { DeployStack } from "../lib/deploy-stack";
import { DnsStack } from "../lib/dns-stack";

// The account is not read from the ambient credentials on purpose. An environment-
// agnostic stack would deploy wherever the shell happens to point, which is how a
// resource ends up in the wrong account and is discovered by its bill.
const env = { account: "917993967998", region: "eu-central-1" };

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
  domainName: "job-application.app",
  alertEmail: "tigoes44@gmail.com",
  monthlyBudget: 20,
});
