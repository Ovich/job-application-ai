import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  HttpVersion,
  OriginRequestPolicy,
  PriceClass,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { FunctionUrlAuthType, InvokeMode, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import type { DatabaseCluster } from "aws-cdk-lib/aws-rds";
import { ARecord, PublicHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import type { Construct } from "constructs";

export interface AppStackProps extends StackProps {
  /** The name the distribution answers on. */
  readonly domainName: string;
  readonly hostedZoneId: string;
  readonly hostedZoneName: string;
  /** From `Cert`, reached across the region boundary. */
  readonly certificateArn: string;
  /** From `Data`, in this region and this account. */
  readonly cluster: DatabaseCluster;
  readonly databaseName: string;
  /** The PostgreSQL role the function authenticates as, with a token, never a password. */
  readonly databaseUser: string;
  /** The directory holding the built web bundle, relative to the repository root. */
  readonly webBundlePath: string;
  /** The API's entry point, relative to the repository root. */
  readonly apiEntryPath: string;
}

/**
 * Everything that can be destroyed and rebuilt from this repository: the function, the
 * bundle, and the distribution that serves both under one name.
 *
 * The one name matters beyond tidiness. Page and API share an origin, so the browser
 * makes no cross-origin request, nothing has to be configured for CORS, and the RPC
 * client never learns a host (ID5). That is why `/api/*` is a behaviour on this
 * distribution rather than a second address.
 */
export class AppStack extends Stack {
  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);

    const zone = PublicHostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    // Declared rather than left to the function, which would otherwise create a group
    // that outlives the stack and keeps its logs for ever.
    const logGroup = new LogGroup(this, "ApiLogs", {
      retention: RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    /**
     * The API. One function for every route, in response-streaming invoke mode from
     * this first deploy rather than from the slice that needs streaming (ID9): a
     * streaming function serves an ordinary buffered JSON response perfectly well, so
     * splitting into a streaming function and a buffered one would buy nothing and
     * would double what has to be deployed and reasoned about.
     */
    const api = new NodejsFunction(this, "Api", {
      entry: props.apiEntryPath,
      handler: "handler",
      runtime: Runtime.NODEJS_24_X,
      memorySize: 512,
      // Long enough for a run that streams and for a cluster that has to wake, which
      // the spec's failure table prices at about fifteen seconds.
      timeout: Duration.minutes(5),
      environment: {
        // The discriminator has to be set explicitly: an unset one falls back to the
        // local runtime, which would point the function at a database on its own
        // loopback interface and fail in a way that reads like a network problem
        // rather than a configuration one (ID23).
        APP_RUNTIME: "cloud",
        DATABASE_HOST: props.cluster.clusterEndpoint.hostname,
        DATABASE_PORT: String(props.cluster.clusterEndpoint.port),
        DATABASE_NAME: props.databaseName,
        DATABASE_USER: props.databaseUser,
      },
      bundling: {
        // Nothing is treated as already present on the platform. Which AWS SDK packages
        // the Node 24 runtime ships is a runtime detail that changes without notice, and
        // the identity-token signer is the one package a wrong guess would break in the
        // cloud only.
        externalModules: [],
        minify: true,
        sourceMap: true,
      },
      // Rule 18 says what a log line may carry; this says how long it is kept. Fourteen
      // days on development is the retention F15 prices, against a default of forever
      // that is a cost line nobody decided.
      logGroup,
    });

    // What lets the function authenticate as a database role without holding a secret.
    // The grant names the role: a token minted for any other user is refused.
    props.cluster.grantConnect(api, props.databaseUser);

    const apiUrl = api.addFunctionUrl({
      // The URL is unreachable except through the distribution, which signs every
      // request it forwards. An unauthenticated function URL would be a second, public
      // front door to the same API with none of the distribution's behaviour on it.
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.RESPONSE_STREAM,
    });

    /** The Angular bundle. Reached only through the distribution, as the API is. */
    const webBucket = new Bucket(this, "WebBucket", {
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const distribution = new Distribution(this, "Distribution", {
      domainNames: [props.domainName],
      certificate: Certificate.fromCertificateArn(this, "Certificate", props.certificateArn),
      httpVersion: HttpVersion.HTTP2_AND_3,
      // Europe and North America. The visitors are Swiss and the edge locations that
      // cost extra serve neither of them.
      priceClass: PriceClass.PRICE_CLASS_100,
      defaultRootObject: "index.html",
      defaultBehavior: {
        origin: S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      additionalBehaviors: {
        "/api/*": {
          origin: FunctionUrlOrigin.withOriginAccessControl(apiUrl),
          viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: AllowedMethods.ALLOW_ALL,
          // An API response is never cached, and neither is a stream.
          cachePolicy: CachePolicy.CACHING_DISABLED,
          /**
           * Everything the viewer sent except the host header. The exception is not
           * cosmetic: the signature the distribution computes covers the host it is
           * sending to, so forwarding the viewer's host makes every signed request
           * fail. `x-amz-content-sha256`, which the browser and the deploy check both
           * set, rides through on this policy.
           */
          originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          /**
           * Compression off, and this is the setting that silently breaks streaming
           * when it is on: CloudFront buffers a response it intends to compress, so
           * every event of a server-sent stream arrives at the end, together, and the
           * page still renders correctly. A test that reads content passes. Only a
           * test that measures arrival fails, which is why `e2e/stream.spec.ts`
           * measures arrival.
           */
          compress: false,
        },
      },
      /**
       * The page is a single-page application: a deep link is a path S3 has no object
       * for, and the router resolves it in the browser. Both codes are mapped because
       * a bucket behind origin access control answers 403 for a missing key rather
       * than 404, so mapping only the latter would leave every deep link broken.
       */
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
      ],
    });

    new BucketDeployment(this, "WebDeployment", {
      sources: [Source.asset(props.webBundlePath)],
      destinationBucket: webBucket,
      distribution,
      // Only the entry document, because everything else carries a content hash in its
      // name and an invalidation of it would be paid for and would change nothing.
      distributionPaths: ["/index.html"],
    });

    new ARecord(this, "AliasRecord", {
      zone,
      recordName: props.domainName,
      target: RecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });

    new CfnOutput(this, "DistributionDomainName", { value: distribution.distributionDomainName });
    new CfnOutput(this, "SiteUrl", { value: `https://${props.domainName}` });
  }
}
