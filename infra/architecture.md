# The infrastructure

What runs in AWS, what each part is for, and which of it is a decision rather than a
default. For an engineer who did not build it and needs to change it, debug it, or
price it.

The templates in this directory are the source: there is no synthesis step and no
generated artefact, so a resource named here is a resource you can find by name in a
`.yaml` beside this file (board `D17`).

## Which environments exist

**One: `dev`.** There is no production.

| Environment | Address | Stacks | State |
|---|---|---|---|
| `dev` | `dev.job-application.app` | `Cert-dev`, `Data-dev`, `App-dev` | the only one deployed |
| `prod` | `job-application.app` | `Cert-prod`, `Data-prod`, `App-prod` | **not deployed, and the templates do not yet exist** |

`Deploy` and `Dns` are shared by both and exist once for the project.

Prod is not a different design: it is a second copy of the same three templates, at the
apex instead of a subdomain. The pipeline deploys `dev` on a merge to `main` and `prod`
on a `v*` tag, with the prod job behind a GitHub environment and a required reviewer
(board `D9`). Until someone writes those three templates and pushes a tag, everything
below describes `dev`.

**To read the truth rather than this document**, which drifts the moment anything
changes:

```sh
aws cloudformation describe-stacks --region eu-central-1 --query "Stacks[].{Name:StackName,Status:StackStatus}" --output table
```

## The account and the regions

| | |
|---|---|
| Account | `917993967998` |
| Region | `eu-central-1`, Frankfurt (board `D14`) |
| Exception | `Cert-dev` in `us-east-1` |
| Domain | `job-application.app`, development at `dev.job-application.app` |
| Hosted zone | `Z01268721BDDLWGJVLJS8` |

The region is stated in `bin`-less templates and in the workflow, never taken from
ambient credentials, so a stack cannot deploy wherever a shell happens to point.

`Cert-dev` is not a preference. CloudFront reads its certificate from `us-east-1` and
from nowhere else, whatever region serves the traffic, and a stack lives in one region —
so the certificate is a stack of its own.

## The three constraints everything else follows from

**Idle cost under CHF 10 a month** (`F15`, rule 17). This is what forbids a NAT gateway
(~CHF 35/month), an RDS proxy, an API Gateway, and always-on database capacity. Twelve
tests in `tests/invariants.test.ts` assert each of those absences, because each was one
line of configuration away from being undone silently.

**Replies must stream.** The chat's answers arrive over server-sent events, which
survives only if nothing between the function and the browser buffers the response.

**Nothing deploys from a laptop.** GitHub Actions holds the only identity that may
change the account, and it is scoped to one repository and one branch.

## The stacks

Five, split by what happens if they are destroyed and by how often they change
(board `D8`).

Dependency graph: which stack needs what from which, and so the order they deploy in.

```mermaid
flowchart TB
  subgraph project["Once for the project"]
    Deploy["<b>Deploy</b><br/>who may change the account"]
    Dns["<b>Dns</b><br/>the domain and the spend alarm"]
  end
  subgraph env["Once per environment"]
    Cert["<b>Cert-dev</b> · us-east-1<br/>the certificate"]
    Data["<b>Data-dev</b><br/>holds the state"]
    App["<b>App-dev</b><br/>rebuildable from the repository"]
  end
  Dns -->|"zone id, for validation"| Cert
  Cert -->|"certificate ARN"| App
  Data -->|"cluster endpoint, resource id"| App
  Deploy -->|"execution role, artefact bucket"| App
  Dns -->|"zone id, for the alias record"| App
```

`Data-dev` carries termination protection and `App-dev` does not: the application can be
torn down and redeployed from the repository, the database cannot.

## The tiers a request passes through

Container diagram: every component that serves a request, from the name to the row, and
which tier it belongs to. Solid arrows are the request; dotted are what a tier needs in
order to do its job.

```mermaid
flowchart TB
  browser(["Browser"])

  subgraph t1["1 · Name — Route 53"]
    AliasRecord["<b>AliasRecord</b><br/>dev.job-application.app → the distribution"]
    Zone["<b>Zone</b><br/>job-application.app"]
  end

  subgraph t2["2 · Edge — CloudFront"]
    Distribution["<b>Distribution</b><br/>TLS for the domain, one origin for both<br/>default: Compress true · /api/*: Compress FALSE"]
    Certificate["<b>Certificate</b><br/>ACM, us-east-1"]
    WebOAC["<b>WebOriginAccessControl</b>"]
    ApiOAC["<b>ApiOriginAccessControl</b><br/>signs, incl. the body hash"]
  end

  subgraph t3["3 · Frontend — S3"]
    WebBucket["<b>WebBucket</b><br/>the Angular bundle"]
    WebBucketPolicy["<b>WebBucketPolicy</b><br/>this distribution only"]
  end

  subgraph t4["4 · API — Lambda"]
    ApiFunctionUrl["<b>ApiFunctionUrl</b><br/>AWS_IAM · RESPONSE_STREAM"]
    Api["<b>Api</b><br/>Hono, every route, outside the VPC"]
    ApiInvoke["<b>ApiInvokeFromDistribution</b>"]
    ApiRole["<b>ApiRole</b> + <b>ApiRolePolicy</b><br/>mints the rds-db:connect token"]
    ApiLogs["<b>ApiLogs</b>"]
  end

  subgraph t5["5 · Data — RDS, inside the VPC"]
    SG["<b>ClusterSecurityGroup</b><br/>5432, TLS forced"]
    Cluster["<b>Cluster</b><br/>Aurora Serverless v2, pauses at 0 ACU"]
    ClusterWriter["<b>ClusterWriter</b>"]
  end

  browser -->|"resolve"| AliasRecord
  browser -->|"https"| Distribution
  Distribution -->|"default behaviour"| WebBucket
  Distribution -->|"/api/* signed SigV4"| ApiFunctionUrl
  ApiFunctionUrl --> Api
  Api -->|"postgres.js, token as password"| SG
  SG --> Cluster
  Cluster --- ClusterWriter

  AliasRecord -.-> Zone
  Certificate -.->|"TLS for the alias"| Distribution
  WebOAC -.-> Distribution
  ApiOAC -.-> Distribution
  WebBucketPolicy -.-> WebBucket
  ApiInvoke -.-> Api
  ApiRole -.-> Api
  Api -.->|"writes"| ApiLogs
```

**Tier 4 sits outside the VPC and tier 5 inside it.** That is the unusual seam: the
function reaches the database over the public endpoint rather than through the network,
which is what removes the NAT gateway. `ClusterSecurityGroup` is the boundary, and TLS
plus a per-connection identity token are what defend it.

**Nothing skips a tier.** The browser cannot reach `ApiFunctionUrl` — it is `AWS_IAM` and
rejects anything the distribution has not signed. It cannot reach `WebBucket` — the
bucket blocks public access and its policy names one distribution. Both origins are
private, and CloudFront is the only door.

## Every resource

### `Deploy` — who may change the account

| Logical id | Type | What it is for |
|---|---|---|
| `GitHubProvider` | `AWS::IAM::OIDCProvider` | Trusts tokens minted by GitHub Actions. One per URL per account |
| `DeployRole` | `AWS::IAM::Role` | `github-actions-deploy-dev`. Assumed by the pipeline; trusts one repository and `refs/heads/main` only |
| `DeployRolePolicy` | `AWS::IAM::Policy` | What the pipeline may do. CloudFormation on these five stacks **by name**, `PassRole` on the execution role, the artefact bucket, the web bucket, and the four statements the migrate step needs |
| `CloudFormationExecutionRole` | `AWS::IAM::Role` | The rights to **create** resources are held here, not by the pipeline. CloudFormation acts as this role, so a mistake in the workflow reaches only what CloudFormation would have done anyway |
| `ArtefactBucket` | `AWS::S3::Bucket` | Holds the Lambda bundle the pipeline uploads |

The last two replace CDK's bootstrap (`cdk-hnb659fds-cfn-exec-role` and its asset
bucket), which deleting CDK deleted.

### `Dns` — the domain and the spend alarm

| Logical id | Type | What it is for |
|---|---|---|
| `Zone` | `AWS::Route53::HostedZone` | `job-application.app`. **`DeletionPolicy: Retain`** |
| `Alerts` | `AWS::SNS::Topic` | Where every alarm reports |
| `AlertsEmailSubscription` | `AWS::SNS::Subscription` | Email. Needs confirming by hand after any recreation |
| `AlertsPolicy` | `AWS::SNS::TopicPolicy` | Lets AWS Budgets publish to the topic |
| `MonthlySpend` | `AWS::Budgets::Budget` | USD 20/month. `US7` |

**The zone is the one resource here that can take the product off the internet.** Its
four name servers are typed by hand at the registrar; a replacement zone gets four
different ones and nothing resolves until they are typed in again and propagate. That is
why it is retained, and why `import-runbook.md` exists.

### `Cert-dev` — the certificate

| Logical id | Type | What it is for |
|---|---|---|
| `Certificate` | `AWS::CertificateManager::Certificate` | `dev.job-application.app`, validated by DNS against the zone |

### `Data-dev` — the state

| Logical id | Type | What it is for |
|---|---|---|
| `Vpc` | `AWS::EC2::VPC` | `10.0.0.0/16`. **No NAT gateway** |
| `InternetGateway`, `InternetGatewayAttachment` | `AWS::EC2::InternetGateway`, `::VPCGatewayAttachment` | What makes the subnets public |
| `PublicSubnet1`, `PublicSubnet2` | `AWS::EC2::Subnet` | Two availability zones because a DB subnet group requires two, not because there is a second instance |
| `PublicSubnet1RouteTable`, `PublicSubnet2RouteTable` | `AWS::EC2::RouteTable` | |
| `PublicSubnet1RouteTableAssociation`, `PublicSubnet2RouteTableAssociation` | `AWS::EC2::SubnetRouteTableAssociation` | |
| `PublicSubnet1DefaultRoute`, `PublicSubnet2DefaultRoute` | `AWS::EC2::Route` | |
| `ClusterSecurityGroup` | `AWS::EC2::SecurityGroup` | 5432 from anywhere. See the trade below |
| `ClusterParameters` | `AWS::RDS::DBClusterParameterGroup` | `rds.force_ssl = 1` |
| `ClusterSubnets` | `AWS::RDS::DBSubnetGroup` | |
| `Cluster` | `AWS::RDS::DBCluster` | Aurora Serverless v2, PostgreSQL. `MinCapacity 0`, `SecondsUntilAutoPause 300`, IAM authentication on |
| `ClusterWriter` | `AWS::RDS::DBInstance` | One instance |

**The trade, stated plainly.** Lambda runs outside the VPC, so it reaches the database
over the public endpoint and the security group opens 5432 to the internet. That is what
buys the absence of a NAT gateway. Three things carry the weight instead: `rds.force_ssl`
refuses any connection that has not negotiated TLS, authentication is an identity token
minted per connection with no password anywhere in the cloud, and the cluster is paused
most of the time. AWS's own linter flags the public endpoint (`W9011`); it is a decision
(`D5`), not an oversight.

### `App-dev` — the application

| Logical id | Type | What it is for |
|---|---|---|
| `ApiLogs` | `AWS::Logs::LogGroup` | Two weeks' retention |
| `ApiRole`, `ApiRolePolicy` | `AWS::IAM::Role`, `::Policy` | What the function may do: `rds-db:connect` as the `api` user, and its own log group |
| `Api` | `AWS::Lambda::Function` | Hono. One function for **every** route |
| `ApiFunctionUrl` | `AWS::Lambda::Url` | `AuthType: AWS_IAM`, `InvokeMode: RESPONSE_STREAM` |
| `ApiInvokeFromDistribution` | `AWS::Lambda::Permission` | Lets one distribution, and only that one, invoke the function |
| `WebBucket`, `WebBucketPolicy` | `AWS::S3::Bucket`, `::BucketPolicy` | The Angular bundle. Readable only by the distribution |
| `WebOriginAccessControl`, `ApiOriginAccessControl` | `AWS::CloudFront::OriginAccessControl` | Sign requests to each origin |
| `Distribution` | `AWS::CloudFront::Distribution` | The front door |
| `AliasRecord` | `AWS::Route53::RecordSet` | `dev.job-application.app` at the distribution |

## What actually runs, and when

Most of what is listed above does not run. It exists — a role, a route table, a policy —
and costs nothing until something uses it. Three groups, and the difference is the whole
cost posture:

| | Resources | Cost shape |
|---|---|---|
| **Always there** | `Zone`, `WebBucket`, `ArtefactBucket`, `ApiLogs`, and the public IPv4 the cluster's endpoint holds | A hosted zone and a public IPv4 are each charged by the hour whether or not anything asks for them. Storage is charged by the byte. These are the fixed line |
| **Runs only when asked** | `Api` (Lambda), `Distribution` (CloudFront) | Per invocation and per request. Nothing at rest |
| **Asleep by default** | `Cluster` (Aurora Serverless v2) | `MinCapacity 0` with `SecondsUntilAutoPause 300`: five idle minutes and it scales to nothing. The first request after that waits while it wakes |
| **Costs nothing, ever** | Every `AWS::IAM::*`, the `Vpc` and its subnets, route tables and gateway, `ClusterSecurityGroup`, `ClusterParameters`, `ClusterSubnets`, both `OriginAccessControl`s, `ApiInvokeFromDistribution`, `MonthlySpend`, `Alerts` | Configuration. It has no runtime |

So on a quiet day the account runs **nothing**: the cluster is paused, the function is
not invoked, and the distribution serves nobody. What is left is a hosted zone, an IPv4
address, and a few megabytes of S3 — which is what makes `F15`'s figure achievable.

State machine: what the account is doing at any moment, and what moves it between.

```mermaid
stateDiagram-v2
  [*] --> Idle
  state "Idle · the default" as Idle
  state "Serving the page" as Page
  state "Waking" as Waking
  state "Working" as Working

  Idle --> Page: GET /
  Page --> Idle: response sent
  Idle --> Waking: first GET or POST /api/* after a pause
  Page --> Waking: the page's first query
  Waking --> Working: cluster resumes
  Working --> Working: further requests, no wait
  Working --> Idle: 300 s with no query

  note left of Idle
    Route 53 · Zone — answers DNS
    EC2 · the cluster's public IPv4 — reserved
    S3 · WebBucket, ArtefactBucket — hold bytes
    CloudWatch Logs · ApiLogs — holds bytes
    RDS · Cluster — PAUSED, 0 ACU
    Lambda · Api — not invoked
    CloudFront · Distribution — serving nobody
  end note
  note right of Page
    Route 53 · AliasRecord — resolves the name
    CloudFront · Distribution — default behaviour,
      Compress true, CachingOptimized
    S3 · WebBucket — read through
      WebOriginAccessControl
    RDS · Cluster — still paused, untouched
  end note
  note right of Waking
    RDS · Cluster — resuming from 0 ACU
    Lambda · Api — invoked, holding the request
    The only slow path. This request waits;
    the ones behind it do not.
  end note
  note right of Working
    CloudFront · Distribution — /api/* behaviour,
      Compress FALSE, caching disabled
    Lambda · Api + ApiFunctionUrl — RESPONSE_STREAM,
      signed by ApiOriginAccessControl
    IAM · ApiRole — mints the rds-db:connect token
    RDS · Cluster + ClusterWriter — billed per ACU-second
    CloudWatch Logs · ApiLogs — written to
  end note
```

**The transition worth knowing is `Page --> Waking`, and that it is not automatic.**
Loading the page costs a CloudFront request and an S3 read and nothing else; only a call
to `/api/*` reaches the function, and only a query reaches the cluster. So a visitor who
looks and leaves never wakes the database.

**And `Waking` is a real wait**, not a warm-up. A paused Aurora Serverless v2 cluster
takes seconds to resume, and the request that triggers it pays for all of them. That is
the cost of `MinCapacity 0`, accepted knowingly: on dev nobody minds, and `D5` says the
pause interval is raised on prod once users arrive so that only the first visitor after a
quiet stretch waits.

The two that do cost while idle are worth knowing by name. The **hosted zone** is
unavoidable: it is the domain. The **public IPv4** is the price of the trade below —
Lambda outside the VPC reaching a public endpoint — and is roughly a tenth of what a NAT
gateway would cost to avoid it.

`MonthlySpend` watches all of it and mails `Alerts` at the threshold, which is `US7`.

## How a request reaches the database

Sequence: what a read touches, and where the two properties that make streaming work are enforced.

```mermaid
sequenceDiagram
  participant B as Browser
  participant D as Distribution
  participant U as ApiFunctionUrl
  participant F as Api (Lambda)
  participant C as Cluster
  B->>D: GET dev.job-application.app/api/runs/latest
  Note over D: /api/* behaviour<br/>Compress FALSE, caching disabled
  D->>U: signed with SigV4 (ApiOriginAccessControl)
  Note over U: AuthType AWS_IAM<br/>rejects anything unsigned
  U->>F: RESPONSE_STREAM
  F->>F: mint an identity token as ApiRole
  F->>C: TLS, token as the password
  Note over C: paused? first request waits<br/>while it wakes
  C-->>F: rows
  F-->>B: streamed through the distribution
```

**Two properties this diagram exists to make visible.**

`Compress: false` on the `/api/*` behaviour. CloudFront compression buffers a response to
its end before sending it, which turns a stream into a single late reply. The default
behaviour serving the web bundle has `Compress: true`, where it is pure gain.

A **write** carries `x-amz-content-sha256`. Origin access control signs the request that
reaches the function and the signature covers a hash of the body, which CloudFront does
not compute — the sender states it. `apps/web/src/app/lib/api.ts` does this for every
write, and anything calling the deployed API from outside the page must do the same.

## How code reaches the account

Phasing: the order a merge is applied in, and where it stops.

```mermaid
flowchart TB
  merge["merge to main"] --> check["check: biome, tsc, 68 + 14 tests, cfn-lint"]
  check --> oidc["assume DeployRole by OIDC"]
  oidc --> shared["Deploy, Dns"]
  shared --> cert["Cert-dev, us-east-1"]
  cert --> bundle["esbuild lambda.ts, upload to ArtefactBucket"]
  bundle --> data["Data-dev, then termination protection"]
  data --> app["App-dev"]
  app --> sync["s3 sync the web bundle, invalidate /index.html"]
  sync --> role["create the api role, GRANT rds_iam"]
  role --> migrate["drizzle-kit migrate, as api, by token"]
  migrate --> done["the pipeline ends here"]
```

Two steps exist because the L2 constructs that did them are gone: `esbuild` replaced
`NodejsFunction`'s bundling, and `s3 sync` replaced `BucketDeployment`.

**The pipeline ships and does not judge** (board `D9` as amended, `ID48`). It ends at the
migration. Whether the feature works is the operator check of `D3`, which a person runs
against the deployed address. The consequence, accepted: CloudFormation reporting success
is not the same as the environment working, so a deploy that breaks DNS, the certificate
or the distribution is reported successful until somebody looks.

**Migrations run after the application**, so new code must tolerate the old schema for
the minute between them, and a failed migration leaves working code with the deploy
already reported successful. Recovering is re-tagging, not a rollback.

**One deploy at a time, never cancelled.** A cancelled CloudFormation update leaves a
stack in a state the next run has to clean up by hand.

## What is not here

**No prod.** `Cert-prod`, `Data-prod` and `App-prod` are a second copy of the same three
templates; `Deploy` and `Dns` are already shared. The pipeline deploys dev on a merge and
prod on a tag, and the prod job sits behind a GitHub environment with a required
reviewer.

**No queue and no worker** (board `D7`). A long AI step runs on the streaming route and
writes each unit of its work as that unit finishes, so a cut connection loses only the
unit in flight.

**No `CDKToolkit`.** The stack of that name still stands in the account and nothing uses
it; it is CDK's bootstrap, left from before the conversion.

## Two failures worth not repeating

Both were latent from the first day and surfaced only when something first tried to use
them. Neither came from the move off CDK — the CDK templates carried the same defects.

**GitHub's OIDC subject now carries immutable ids.** A trust policy matching
`repo:OWNER/REPO:ref:refs/heads/main` is refused, because the claim reads
`repo:OWNER@<ownerId>/REPO@<repoId>:ref:refs/heads/main`. The policy looks correct and
`StringEquals` is exact. **CloudTrail's record of the claim is the only place the
difference is visible** — for an OIDC denial, go there before auditing the policy.

**EC2 takes a security group rule description only from
`a-zA-Z0-9. _-:/()#,@[]+=&;{}!$*`.** An apostrophe rejects the whole stack, twelve
minutes into Aurora provisioning. Valid YAML, valid CloudFormation, `cfn-lint` clean:
only EC2's resource handler knows the rule. `tests/invariants.test.ts` asserts the
character set now.

## Changing any of this

Templates are applied by the pipeline, never from a laptop. The exceptions are named and
few: the original bootstrap, and step 5 of `import-runbook.md`, both of which create the
identity the pipeline needs in order to exist.

Before changing a template, know that `tests/invariants.test.ts` will refuse a change
that undoes a foundation decision, and `tests/parity.test.ts` will refuse any difference
from what CDK produced that is not declared with its reason. The second is a migration
check and is expected to retire once the conversion has proven itself (`ID53`); the first
is permanent.
