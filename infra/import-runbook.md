# Adopting the two live stacks

`Deploy` and `Dns` are deployed. The other three are not, so they simply get created from
their new templates and nothing in this document applies to them.

These two are different, and the difference is the whole reason this file exists. Every
logical id in the old stacks was invented by CDK — `ZoneA5DE4B68`, `Alerts91F83244`,
`DeployDevelopmentRole4080F27A` — and the new templates use readable ones. To
CloudFormation a renamed logical id is not a rename: it is a new resource, plus the
deletion of the old one. Applied naively that would **destroy the hosted zone**, and the
zone's four name servers are typed in by hand at Spaceship, the registrar. A new zone
gets four different ones, and `job-application.app` stops resolving for everyone until
somebody types the new ones in and the change propagates.

So the resources are kept and the stacks are rebuilt around them: mark everything that
must survive as retained, delete the stacks, then create new stacks that **import** the
surviving resources under their new names.

Read the whole file before starting. Every step says how to undo it, and the one step
that cannot be undone says so.

---

## Before you start

**Who.** A person, with their own administrator credentials. Not the pipeline: the
`github-actions-deploy-dev` role may not delete a stack, and this procedure deletes the
stack that grants it anything at all.

**What you need.**

- AWS CLI v2. `aws --version` must answer. _(It was not installed on the machine this
  runbook was written on — install it first.)_
- Credentials for account `917993967998` with administrator rights, and
  `AWS_REGION=eu-central-1` (both stacks live there; Route 53 and IAM are global, but the
  stacks are not).
- A checkout of this repository, so that `infra/*.yaml` is at hand. Run every command
  from the repository root.
- Roughly forty minutes, and nobody merging to `main` while you work. Between step 3 and
  step 5 the pipeline cannot deploy.

**Take the "before" record.** Everything in step 7 is checked against these four
outputs, so capture them to a file you keep until you are done.

```sh
aws route53 get-hosted-zone --id Z01268721BDDLWGJVLJS8 > before-zone.json
aws cloudformation describe-stack-resources --stack-name Dns > before-dns.json
aws cloudformation describe-stack-resources --stack-name Deploy > before-deploy.json
nslookup -type=NS dev.job-application.app
```

`before-zone.json` holds the zone's id and its four name servers. Those two facts are the
acceptance criterion of the whole exercise: **the id is the same afterwards and the four
name servers are the same afterwards.**

**Also keep the templates as they are now**, so step 2 can be undone:

```sh
aws cloudformation get-template --stack-name Dns    --template-stage Original \
  --query TemplateBody > before-dns-template.json
aws cloudformation get-template --stack-name Deploy --template-stage Original \
  --query TemplateBody > before-deploy-template.json
```

---

## What survives and what is rebuilt

| Resource                                      | Old logical id                               | Then                                                                                                                  |
| --------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The hosted zone                               | `ZoneA5DE4B68`                               | **retained and imported.** It cannot be recreated.                                                                    |
| The alert topic                               | `Alerts91F83244`                             | **retained and imported.** Recreating it would drop the confirmed subscription.                                       |
| The GitHub OIDC provider                      | `GitHubProviderDD1D07DF`                     | **retained and imported.** An account may hold only one provider per URL, so a second cannot be created alongside.    |
| The deploy role                               | `DeployDevelopmentRole4080F27A`              | **retained and imported.** Its name, `github-actions-deploy-dev`, is fixed and is written into a repository variable. |
| The email subscription                        | `Alertstigoes44gmailcomE68ABA00`             | deleted and recreated. **You will have to confirm the email again.**                                                  |
| The topic policy                              | `AlertsPolicy425C338D`                       | deleted and recreated. Nothing is lost.                                                                               |
| The budget                                    | `MonthlySpend`                               | deleted and recreated. It carries no history worth keeping.                                                           |
| The deploy role's policy                      | `DeployDevelopmentRoleDefaultPolicy4E90BCDF` | deleted and recreated, with different contents: the pipeline no longer assumes CDK's bootstrap roles.                 |
| CDK's custom-resource Lambdas and their roles | several                                      | deleted. They existed to make the OIDC provider; the new template uses `AWS::IAM::OIDCProvider` and needs none.       |

The four rows marked "retained and imported" are what steps 2 and 4 are about. The rest
are ordinary creates in step 5.

---

## Step 1 — Check that nothing is mid-flight

```sh
aws cloudformation describe-stacks --stack-name Dns    --query "Stacks[0].StackStatus"
aws cloudformation describe-stacks --stack-name Deploy --query "Stacks[0].StackStatus"
```

Both must read `CREATE_COMPLETE` or `UPDATE_COMPLETE`. Anything ending in `_IN_PROGRESS`
means somebody or something is deploying; wait. Anything ending in `_FAILED` means fix
that first — this procedure assumes a healthy stack.

**Undo:** nothing was changed.

---

## Step 2 — Mark the four resources as retained

This is the step that makes step 3 safe. Deleting a stack deletes its resources unless
each one carries `DeletionPolicy: Retain`, and CDK wrote no such policy.

Edit the two templates you saved (`before-dns-template.json`,
`before-deploy-template.json`) — **keep CDK's logical ids exactly as they are, this is
still the old stack** — and add one line to four resources:

- in the `Dns` template, to `ZoneA5DE4B68` and to `Alerts91F83244`
- in the `Deploy` template, to `GitHubProviderDD1D07DF` and to
  `DeployDevelopmentRole4080F27A`

each of them getting:

```json
"DeletionPolicy": "Retain"
```

Save them as `retain-dns.json` and `retain-deploy.json` and apply them:

```sh
aws cloudformation deploy --template-file retain-dns.json    --stack-name Dns \
  --capabilities CAPABILITY_NAMED_IAM
aws cloudformation deploy --template-file retain-deploy.json --stack-name Deploy \
  --capabilities CAPABILITY_NAMED_IAM
```

**Verify before going on.** A missed policy here is how the zone gets destroyed in step 3.

```sh
aws cloudformation get-template --stack-name Dns    --template-stage Processed \
  | grep -c '"DeletionPolicy": "Retain"'   # must be 2
aws cloudformation get-template --stack-name Deploy --template-stage Processed \
  | grep -c '"DeletionPolicy": "Retain"'   # must be 2 or more
```

On `Deploy` the count may be higher: CDK writes `"DeletionPolicy": "Delete"` on its own
custom resources, and one of them, `GitHubProviderDD1D07DF`, is one you are changing.
Read the output rather than trusting the count if it surprises you.

**Undo:** apply `before-dns-template.json` / `before-deploy-template.json` again. Nothing
outside CloudFormation has changed.

---

## Step 3 — Delete the two stacks

**This is the step that cannot be undone.** Everything before it was reversible;
everything after it is a repair rather than a rollback.

Do `Dns` first, on its own, and check the zone before touching `Deploy`.

```sh
aws cloudformation delete-stack --stack-name Dns
aws cloudformation wait stack-delete-complete --stack-name Dns
```

**Then, immediately:**

```sh
aws route53 get-hosted-zone --id Z01268721BDDLWGJVLJS8
nslookup -type=NS dev.job-application.app
```

The zone must still be there, its id must be `Z01268721BDDLWGJVLJS8`, and its four name
servers must match `before-zone.json`.

> **Abort here if the zone is gone.** Do not continue. Create a new public hosted zone
> for `job-application.app`, read its four name servers, set them at Spaceship, and wait
> for propagation. The domain is dark until you do. Then start this runbook again with
> the new zone id, and change the id in `infra/Dns.yaml`, `infra/Cert-dev.yaml` and
> `infra/App-dev.yaml`, where it is written out.

Only when the zone has been confirmed:

```sh
aws cloudformation delete-stack --stack-name Deploy
aws cloudformation wait stack-delete-complete --stack-name Deploy
aws iam get-role --role-name github-actions-deploy-dev
aws iam list-open-id-connect-providers
```

The role must still exist and the provider list must still contain
`token.actions.githubusercontent.com`.

**Undo:** none. If a resource was deleted that should not have been, it is gone and has
to be recreated; the "abort" note above is the procedure for the zone, and for the role
and the provider the repair is simply to let step 5 create them instead of importing them
(delete their entry from the import file in step 4).

---

## Step 4 — Create the new stacks by importing what survived

A create-by-import change set may contain **only** the resources being imported, which is
why `infra/import/` holds a reduced copy of each template. Step 5 then adds the rest.

First collect the two identifiers the import needs:

```sh
TOPIC_ARN=$(jq -r '.StackResources[]|select(.LogicalResourceId=="Alerts91F83244").PhysicalResourceId' before-dns.json)
PROVIDER_ARN=$(jq -r '.StackResources[]|select(.LogicalResourceId=="GitHubProviderDD1D07DF").PhysicalResourceId' before-deploy.json)
echo "$TOPIC_ARN" "$PROVIDER_ARN"
```

### Dns

```sh
aws cloudformation create-change-set \
  --stack-name Dns \
  --change-set-name import-the-zone \
  --change-set-type IMPORT \
  --template-body file://infra/import/Dns.import.yaml \
  --resources-to-import "[
    {\"ResourceType\":\"AWS::Route53::HostedZone\",\"LogicalResourceId\":\"Zone\",
     \"ResourceIdentifier\":{\"Id\":\"Z01268721BDDLWGJVLJS8\"}},
    {\"ResourceType\":\"AWS::SNS::Topic\",\"LogicalResourceId\":\"Alerts\",
     \"ResourceIdentifier\":{\"TopicArn\":\"$TOPIC_ARN\"}}
  ]"

aws cloudformation wait change-set-create-complete \
  --stack-name Dns --change-set-name import-the-zone
aws cloudformation describe-change-set \
  --stack-name Dns --change-set-name import-the-zone \
  --query "Changes[].ResourceChange.{Action:Action,Id:LogicalResourceId}"
```

Both changes must read `Import`. If either reads `Add`, the identifier is wrong and
CloudFormation is about to create a second resource — **do not execute it.**

```sh
aws cloudformation execute-change-set --stack-name Dns --change-set-name import-the-zone
aws cloudformation wait stack-import-complete --stack-name Dns
```

### Deploy

```sh
aws cloudformation create-change-set \
  --stack-name Deploy \
  --change-set-name import-the-identity \
  --change-set-type IMPORT \
  --template-body file://infra/import/Deploy.import.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --resources-to-import "[
    {\"ResourceType\":\"AWS::IAM::OIDCProvider\",\"LogicalResourceId\":\"GitHubProvider\",
     \"ResourceIdentifier\":{\"Arn\":\"$PROVIDER_ARN\"}},
    {\"ResourceType\":\"AWS::IAM::Role\",\"LogicalResourceId\":\"DeployRole\",
     \"ResourceIdentifier\":{\"RoleName\":\"github-actions-deploy-dev\"}}
  ]"

aws cloudformation wait change-set-create-complete \
  --stack-name Deploy --change-set-name import-the-identity
aws cloudformation describe-change-set \
  --stack-name Deploy --change-set-name import-the-identity \
  --query "Changes[].ResourceChange.{Action:Action,Id:LogicalResourceId}"
aws cloudformation execute-change-set \
  --stack-name Deploy --change-set-name import-the-identity
aws cloudformation wait stack-import-complete --stack-name Deploy
```

**Undo:** a change set that fails to create leaves the stack in `REVIEW_IN_PROGRESS` and
touches nothing. Delete the change set, or `aws cloudformation delete-stack` the stack in
that state — a stack in `REVIEW_IN_PROGRESS` owns no resources, so deleting it is safe —
and try again. A change set that fails while _executing_ rolls the import back and the
resources stay where they were.

---

## Step 5 — Deploy the full templates

The stacks now hold the four imported resources and nothing else. This adds the rest: the
subscription, the topic policy, the budget, the deploy role's policy, the CloudFormation
execution role and the artefact bucket.

```sh
aws cloudformation deploy --template-file infra/Dns.yaml --stack-name Dns \
  --capabilities CAPABILITY_NAMED_IAM
aws cloudformation deploy --template-file infra/Deploy.yaml --stack-name Deploy \
  --capabilities CAPABILITY_NAMED_IAM
```

Do not pass `--role-arn` here. The execution role these two create is what every later
deploy uses; it does not exist yet, and this is the one deploy that runs on your own
credentials. That is the same exception the very first bootstrap made.

**Undo:** a failed create rolls back on its own, and the four imported resources carry
`DeletionPolicy: Retain`, so a rollback leaves them standing.

---

## Step 6 — Confirm the alert email

Deleting the old subscription unsubscribed the address. SNS has sent a new confirmation
mail to `tigoes44@gmail.com`; open it and follow the link.

```sh
aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" \
  --query "Subscriptions[].{Endpoint:Endpoint,Arn:SubscriptionArn}"
```

`SubscriptionArn` reads `PendingConfirmation` until the link is followed, and an
unconfirmed subscription delivers nothing — which means the spend alert is silent. This
step is not optional.

---

## Step 7 — Verify against the "before" record

```sh
# The two facts the whole exercise is about.
aws route53 get-hosted-zone --id Z01268721BDDLWGJVLJS8 \
  --query "{Id:HostedZone.Id,NameServers:DelegationSet.NameServers}"
nslookup -type=NS dev.job-application.app

# The stacks now describe what is actually there.
aws cloudformation detect-stack-drift --stack-name Dns
aws cloudformation detect-stack-drift --stack-name Deploy
# then, per returned id:
aws cloudformation describe-stack-resource-drifts --stack-name Dns
aws cloudformation describe-stack-resource-drifts --stack-name Deploy

# The identity the pipeline uses.
aws iam get-role --role-name github-actions-deploy-dev --query "Role.Arn"
aws iam get-role --role-name job-application-cloudformation-execution --query "Role.Arn"
aws budgets describe-budgets --account-id 917993967998 \
  --query "Budgets[?BudgetName=='monthly-spend'].BudgetLimit"
```

Done means all of:

- the zone's id is `Z01268721BDDLWGJVLJS8`, unchanged;
- its four name servers match `before-zone.json`, unchanged;
- `dev.job-application.app` still answers with a delegation;
- both stacks report no drifted resources;
- the email subscription is confirmed;
- and the next merge to `main` deploys green.

Run the deploy workflow once by hand (`gh workflow run deploy.yml --ref main`) rather than
waiting for a merge, so that a broken deploy identity is found now, while you still have
this file open.

---

## Step 8 — Clean up

Once the pipeline has deployed green:

```sh
git rm -r infra/import
```

The reduced templates exist for one import and cannot be run twice. Leaving them behind
would leave two files claiming to describe the same stacks, and only one of them true.

Delete the local scratch files too (`before-*.json`, `retain-*.json`) — they contain
nothing secret, but they describe a state that no longer exists.
