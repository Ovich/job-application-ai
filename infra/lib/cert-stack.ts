import { Stack, type StackProps } from "aws-cdk-lib";
import { Certificate, CertificateValidation } from "aws-cdk-lib/aws-certificatemanager";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import type { Construct } from "constructs";

export interface CertStackProps extends StackProps {
  /** The name the distribution answers on, `dev.job-application.app` today. */
  readonly domainName: string;
  /** The zone `Dns` created. Passed as a value, not imported: see the note below. */
  readonly hostedZoneId: string;
  readonly hostedZoneName: string;
}

/**
 * The certificate, and the only reason this stack exists separately.
 *
 * CloudFront reads its certificate from `us-east-1` and from nowhere else, whatever
 * region the distribution serves from. A certificate is therefore not something the
 * App stack can hold, and the split is AWS's, not a design preference (F10, board D8).
 *
 * The zone is passed in by identifier rather than imported from the `Dns` stack. A
 * CloudFormation export cannot be read across a region, and a context lookup would
 * need credentials at synth time, which would make `cdk synth` on a laptop behave
 * differently from `cdk synth` in the pipeline. The identifier is a name, it changes
 * only if the zone is destroyed, and `bin/app.ts` already states the account the same
 * way and for the same reason.
 */
export class CertStack extends Stack {
  /** Read by the App stack through a cross-region reference. */
  readonly certificateArn: string;

  constructor(scope: Construct, id: string, props: CertStackProps) {
    super(scope, id, props);

    const zone = PublicHostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    // DNS validation rather than email: the validation record is written into the zone
    // by CloudFormation, so issuance and renewal both happen with nobody watching a
    // mailbox. It only completes once the registrar points at these name servers,
    // which is why the bootstrap does that before anything is deployed.
    const certificate = new Certificate(this, "Certificate", {
      domainName: props.domainName,
      validation: CertificateValidation.fromDns(zone),
    });

    this.certificateArn = certificate.certificateArn;
  }
}
