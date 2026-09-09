import { Stack, type StackProps } from "aws-cdk-lib";
import {
  Effect,
  OpenIdConnectProvider,
  PolicyStatement,
  Role,
  WebIdentityPrincipal,
} from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

export interface DeployStackProps extends StackProps {
  readonly githubOwner: string;
  readonly githubRepository: string;
}

/**
 * The identity GitHub Actions deploys as.
 *
 * This is the one stack deployed from a laptop, and deploying it is what makes every
 * later deploy come from the pipeline instead: it replaces a stored access key with a
 * trust relationship. Actions presents a signed token describing which repository and
 * which branch is running; AWS verifies it against GitHub's OpenID Connect provider and
 * issues credentials that expire. Nothing is stored on either side.
 */
export class DeployStack extends Stack {
  constructor(scope: Construct, id: string, props: DeployStackProps) {
    super(scope, id, props);

    const provider = new OpenIdConnectProvider(this, "GitHubProvider", {
      url: "https://token.actions.githubusercontent.com",
      // The audience AWS requires the token to be addressed to. Without it a token
      // minted for any other service would be accepted here.
      clientIds: ["sts.amazonaws.com"],
    });

    const repository = `${props.githubOwner}/${props.githubRepository}`;

    // The condition is the whole security boundary. `sub` names the repository AND the
    // ref, so a fork, a pull request from one, or a push to any other branch produces a
    // token this role will not accept. Matching on the repository alone would let any
    // branch anyone can push deploy to the account.
    const developmentRole = new Role(this, "DeployDevelopmentRole", {
      roleName: "github-actions-deploy-dev",
      description:
        "Assumed by GitHub Actions on a push to main, to deploy the development environment.",
      assumedBy: new WebIdentityPrincipal(provider.openIdConnectProviderArn, {
        StringEquals: {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": `repo:${repository}:ref:refs/heads/main`,
        },
      }),
    });

    // The role holds almost nothing itself: it may assume the roles that bootstrapping
    // created, and those carry the deployment rights. This is CDK's own model, and it
    // keeps the blast radius of the pipeline's identity to what CloudFormation does
    // rather than to everything an administrator could do.
    developmentRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-hnb659fds-*-${this.account}-*`],
      }),
    );

    // The version the toolkit wrote when the region was bootstrapped. The workflow reads
    // it to fail early and legibly when a region was never bootstrapped, rather than
    // failing later inside a deployment.
    developmentRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["ssm:GetParameter"],
        resources: [`arn:aws:ssm:*:${this.account}:parameter/cdk-bootstrap/*`],
      }),
    );

    /**
     * What the pipeline does that is not a deployment: it migrates the database.
     *
     * Everything above this point is CloudFormation, which acts as the bootstrap roles
     * and needs nothing from this identity. The migrate step is different — it opens a
     * PostgreSQL connection itself — so these are the rights it needs and the only ones
     * held directly. They are read-only but for the database connection, which is the
     * same identity token the function uses and grants exactly what the `api` role has
     * inside PostgreSQL.
     */
    developmentRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        // Where the cluster is, and which secret RDS manages its master password in.
        actions: ["rds:DescribeDBClusters", "cloudformation:DescribeStacks"],
        resources: ["*"],
      }),
    );
    developmentRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        // One statement, once: creating the `api` role and granting it `rds_iam`, which
        // only a password login can do. Scoped to the secrets RDS itself manages, so
        // this cannot read any secret the application ever holds.
        actions: ["secretsmanager:GetSecretValue"],
        resources: [`arn:aws:secretsmanager:*:${this.account}:secret:rds!cluster-*`],
      }),
    );
    developmentRole.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["rds-db:connect"],
        // The database user is named in the resource, so a token minted for any other
        // PostgreSQL role is refused. The cluster's resource id is not known here: it
        // is created by a stack this stack knows nothing about, and it changes if the
        // cluster is ever restored from a snapshot.
        resources: [`arn:aws:rds-db:*:${this.account}:dbuser:*/api`],
      }),
    );
  }
}
