# job-application.app

The AI job-seeker platform. A job seeker builds one profile from every CV they have,
then, per job offer, a tailored CV and cover letter through one conversation that never
invents a claim.

This repository is at its foundation: the smallest deployable system the features stand
on. What runs today is one page showing a run and its units, read out of PostgreSQL,
through Drizzle, through a Hono handler, into an Angular page, with no hand-written type
anywhere along that chain.

## Before you start

Three things trip a first run, and none of them produces an error that names itself.

| What | Why |
| --- | --- |
| **Node 24.15 or newer** | Angular 22 refuses to start below it. `.nvmrc` names the version; run `nvm use` in the repository root, elevated on Windows. |
| **pnpm 11** | The workspace uses pnpm 11's `allowBuilds`, which pnpm 9 and 10 ignore silently. |
| **Docker Desktop running** | Not merely installed. When it is closed, `docker compose` fails with a pipe error that says nothing about Docker. |
| **Port 5432 free** | Another PostgreSQL on the default port will take the connection and then fail to find the schema. |

## Run it

```sh
pnpm install
pnpm dev
```

That brings up PostgreSQL 18 in a container, waits for it to be healthy, applies the
migrations, and serves the API on port 3000 and the web app on port 4200 together.
Open `http://localhost:4200`.

The major is the deployed database's: the Neon project answers PostgreSQL 18.6 and
cannot change major, so the container follows it. A clone that ran the 17 container
before 2026-09-10 has a volume with a 17 cluster in it; `docker compose down -v` drops
it, and the next `pnpm dev` starts a fresh 18 cluster. Nothing in it was worth keeping.

An empty database shows the empty state, which is correct rather than broken. To put
something on the page:

```sh
curl -X POST http://localhost:3000/api/runs \
  -H "content-type: application/json" \
  -d '{"kind":"demo","units":3}'
```

Every unit will read `pending`, and will stay there. Nothing processes units yet; that
arrives with the resumable run later in the foundation.

Stopping `pnpm dev` leaves the container up, so your data survives a restart. To stop
the database too:

```sh
docker compose down
```

## The commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | database, migrations, API and web app, together |
| `pnpm check` | lint, typecheck across every member, and both test suites. This is what CI runs. |
| `pnpm format` | apply the formatter |
| `pnpm --filter @app/db db:generate --name=<what_it_does>` | a new migration. The name is not optional; see the conventions file. |

## How it reaches the internet

Nobody deploys from a laptop. A merge to `main` runs `.github/workflows/deploy.yml`,
which builds the bundle, deploys the stacks, migrates and then proves the result with a
browser check against `https://dev.job-application.app`. A deploy that finishes without
that check passing is not a deploy that worked.

GitHub holds no AWS key. Actions presents a signed token naming the repository and the
branch, and the deployment role trusts exactly `refs/heads/main`, so no other branch and
no fork can obtain credentials. Two repository *variables* say where to go:
`AWS_DEPLOY_ROLE_ARN_DEV` and `AWS_REGION`. Neither is a secret; a role name grants
nothing without a token that matches the trust condition.

Two consequences of the order, both deliberate. The migration runs **after** the
application, so new code must tolerate the old schema for the minute between them. And a
failed migration leaves working code with the deploy already reported successful:
nothing rolls back, and recovering means shipping a fix.

```sh
cd infra && cfn-lint     # the templates against CloudFormation's own specification
pnpm test:e2e            # the browser specs against your local stack
pnpm test:e2e:deployed   # the deploy check, against the development address
```

`pnpm check` already runs the tests in `infra/tests`: the invariants of rule 17 — no NAT
gateway, no API Gateway, no RDS proxy, no VPC at all, compression off on `/api/*`. Each
was proven to bite by making the violation and watching the test go red. `cfn-lint` is a
Python tool and is the one check `pnpm check` leaves
to CI, so that a laptop with only Node on it can still run everything else.

## The layout

```text
apps/web      Angular 22, standalone, signals, zoneless
apps/api      Hono on Node today, on Lambda in the cloud
packages/db   the Drizzle schema, the single source of truth for data shapes
infra         CloudFormation YAML: Deploy and Dns once, Cert-dev and App-dev per environment
```

Types flow one way and are never written twice: the Drizzle schema defines the row
shapes, the API projects them into responses, and the web app infers those responses
back off the RPC client. There is no shared type package and no generated client, by
design. `apps/web` must not import `packages/db`; the linter enforces that, along with
three other boundaries, so a violation fails the build rather than review.

## Before you change anything

Read `CLAUDE.md`. It is the binding conventions file for this repository, it is short,
and the rules in it are enforced by review and in several cases by the linter. It also
explains the one escape hatch for when a rule is genuinely wrong for a piece of code.
