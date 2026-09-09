import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Peer, Port, SecurityGroup, SubnetType, Vpc } from "aws-cdk-lib/aws-ec2";
import {
  AuroraPostgresEngineVersion,
  ClusterInstance,
  Credentials,
  DatabaseCluster,
  DatabaseClusterEngine,
  ParameterGroup,
} from "aws-cdk-lib/aws-rds";
import type { Construct } from "constructs";

export interface DataStackProps extends StackProps {
  /** The database the application connects to. */
  readonly databaseName: string;
  /** The master user Aurora insists on. Nothing but the pipeline's one-time step uses it. */
  readonly masterUsername: string;
}

/**
 * What holds state, kept in its own stack so that tearing down and redeploying the
 * application never touches the data (board D8). Termination protection is on for the
 * same reason: this is the stack that cannot be recreated from the repository.
 */
export class DataStack extends Stack {
  readonly cluster: DatabaseCluster;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, { ...props, terminationProtection: true });

    /**
     * Public subnets only, and no NAT gateway. A NAT gateway is about CHF 35 a month
     * before any traffic, which is the single largest trap rule 17 names, and it would
     * buy nothing here: the Lambda is outside the VPC entirely (F10), so nothing in
     * these subnets ever makes an outbound connection. Two availability zones because
     * a DB subnet group requires them, not because there is a second instance.
     */
    const vpc = new Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [{ name: "public", subnetType: SubnetType.PUBLIC, cidrMask: 24 }],
    });

    /**
     * The cluster is reachable from the internet, which looks alarming written down and
     * is what the cost posture buys. The alternative is a Lambda inside the VPC, and
     * that is the NAT gateway again. What protects the database instead: TLS is forced
     * by the parameter group below, so no connection is ever in the clear, and password
     * authentication is not used by anything — the application and the pipeline both
     * present a short-lived identity token, so knowing the endpoint grants nothing.
     */
    const securityGroup = new SecurityGroup(this, "ClusterSecurityGroup", {
      vpc,
      description: "Postgres, reachable from outside the VPC because nothing runs inside it.",
      allowAllOutbound: false,
    });
    securityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(5432),
      "The API on Lambda and the pipeline's migrate step, neither of which is in this VPC.",
    );

    // `rds.force_ssl` is the setting that makes the public endpoint acceptable: a
    // connection that does not negotiate TLS is refused by the server rather than
    // trusted to have asked for it.
    const parameterGroup = new ParameterGroup(this, "ClusterParameters", {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_17_5,
      }),
      description: "TLS required on every connection.",
      parameters: { "rds.force_ssl": "1" },
    });

    this.cluster = new DatabaseCluster(this, "Cluster", {
      engine: DatabaseClusterEngine.auroraPostgres({
        version: AuroraPostgresEngineVersion.VER_17_5,
      }),
      parameterGroup,
      defaultDatabaseName: props.databaseName,
      vpc,
      vpcSubnets: { subnetType: SubnetType.PUBLIC },
      securityGroups: [securityGroup],

      /**
       * The whole cost posture in three lines. Zero minimum capacity is what lets the
       * cluster pause; the pause duration is the idleness it waits for first, and the
       * driver's own twenty-second idle timeout is what makes the cluster ever look
       * idle at all. Waking costs the first request of a quiet stretch about fifteen
       * seconds, which the spec's failure table accepts by name.
       */
      serverlessV2MinCapacity: 0,
      serverlessV2MaxCapacity: 2,
      serverlessV2AutoPauseDuration: Duration.minutes(5),
      writer: ClusterInstance.serverlessV2("Writer", { publiclyAccessible: true }),

      /**
       * Authentication is by identity token: the API and the pipeline both present a
       * fifteen-minute token minted from their IAM role, and neither holds a password.
       *
       * A master user still has to exist, because Aurora will not create a cluster
       * without one and because PostgreSQL's `rds_iam` grant can only be given by
       * somebody already connected. `manageMasterUserPassword` makes RDS generate and
       * rotate that password itself, so it never passes through CDK, the repository or
       * a log; the pipeline reads it from the managed secret for exactly one statement,
       * the one that creates the application's role, and uses a token thereafter.
       */
      iamAuthentication: true,
      manageMasterUserPassword: true,
      credentials: Credentials.fromUsername(props.masterUsername),
      // The Data API was declined by the board: a pooled connection beats an HTTPS
      // round trip per statement on a schema that issues many small queries (F8).
      enableDataApi: false,

      backup: { retention: Duration.days(7) },
      storageEncrypted: true,
      // Development only, and the stack it lives in is termination protected anyway.
      removalPolicy: RemovalPolicy.SNAPSHOT,
      cloudwatchLogsExports: ["postgresql"],
    });

    // Read by the pipeline, which needs the cluster before it can ask RDS for the
    // endpoint and for the name of the secret RDS chose. The identifier is the one part
    // of that chain the template knows.
    new CfnOutput(this, "ClusterIdentifier", { value: this.cluster.clusterIdentifier });
  }
}
