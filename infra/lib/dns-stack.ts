import { CfnOutput, Fn, Stack, type StackProps } from "aws-cdk-lib";
import { CfnBudget } from "aws-cdk-lib/aws-budgets";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

export interface DnsStackProps extends StackProps {
  readonly domainName: string;
  readonly alertEmail: string;
  /** Monthly ceiling, in the account's billing currency. */
  readonly monthlyBudget: number;
}

/**
 * Created once for the project: the zone every environment's records live in, the one
 * topic every alarm reports to, and the alarm on spend.
 *
 * The zone is here rather than in an environment stack because a domain is not owned by
 * an environment: production sits at the apex and development at a subdomain of the same
 * name, and the registrar can only point at one set of name servers.
 */
export class DnsStack extends Stack {
  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const zone = new PublicHostedZone(this, "Zone", {
      zoneName: props.domainName,
      comment: "job-application.app. Name servers set at Spaceship, the registrar.",
    });

    // One topic for every alarm the project raises, so there is a single place to change
    // where alerts go. The three CloudWatch alarms arrive with the App stack.
    const alerts = new Topic(this, "Alerts", {
      displayName: "job-application.app alerts",
    });
    alerts.addSubscription(new EmailSubscription(props.alertEmail));

    // Budgets is not a CloudWatch alarm and does not assume it may publish here; it must
    // be granted that, and scoped to this account so no other account's budget can use
    // the topic as a megaphone.
    alerts.addToResourcePolicy(
      new PolicyStatement({
        principals: [new ServicePrincipal("budgets.amazonaws.com")],
        actions: ["SNS:Publish"],
        resources: [alerts.topicArn],
        conditions: { StringEquals: { "aws:SourceAccount": this.account } },
      }),
    );

    new CfnBudget(this, "MonthlySpend", {
      budget: {
        budgetName: "monthly-spend",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: props.monthlyBudget, unit: "USD" },
      },
      notificationsWithSubscribers: [
        {
          // Warns while the month can still be changed, which is the point of US7:
          // learn it from an alert rather than from a bill.
          notification: {
            notificationType: "FORECASTED",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "SNS", address: alerts.topicArn }],
        },
        {
          notification: {
            notificationType: "ACTUAL",
            comparisonOperator: "GREATER_THAN",
            threshold: 100,
            thresholdType: "PERCENTAGE",
          },
          subscribers: [{ subscriptionType: "SNS", address: alerts.topicArn }],
        },
      ],
    });

    new CfnOutput(this, "NameServers", {
      // The zone's name servers are only known after CloudFormation creates it, so
      // this is a token standing in for a list. Joining it in JavaScript would
      // concatenate the placeholder, not the values; the join has to happen in the
      // template, which is what Fn.join emits.
      value: Fn.join(", ", zone.hostedZoneNameServers ?? []),
      description:
        "Set these four at the registrar. Nothing validates a certificate until they propagate.",
    });
    new CfnOutput(this, "AlertTopicArn", { value: alerts.topicArn });
  }
}
