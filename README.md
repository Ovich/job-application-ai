# job-application.app

The AI job-seeker platform. A job seeker builds one profile from every CV they have,
then, per job offer, a tailored CV and cover letter through one conversation that never
invents a claim.

This repository is at its foundation: the smallest deployable system the features stand
on, with nothing on it yet, and nothing in it that nothing calls (board `D20`). The web
app is an empty shell: a router outlet, the typed RPC client and the UI kit, with the
root route free for the first real screen. The API keeps one route, `GET /api/health`,
which answers after a real `select version()`, and `GET /api/health/stream`, which beats
through the stream envelope: together they prove after every deploy that the merge
reached the cloud, that the database answers and that a stream survives the
distribution. The database schema is empty until board `D11`'s `message` table brings
the conversation. Along the whole chain there is no hand-written type.

The `run` and `run_unit` skeleton that stood here — invented in the first slice to have
something to deploy, and the pattern for resuming a stream on a `(run, seq)` write —
lives at the tag **`foundation-skeleton`**, not on a branch: `git show
foundation-skeleton:apps/api/src/lib/runs/progress.ts`.

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
`http://localhost:4200` serves the shell, which shows nothing yet.

The major is the deployed database's: the Neon project answers PostgreSQL 18.6 and
cannot change major, so the container follows it. A clone that ran the 17 container
before 2026-09-10 has a volume with a 17 cluster in it; `docker compose down -v` drops
it, and the next `pnpm dev` starts a fresh 18 cluster. Nothing in it was worth keeping.

The health route is what an operator asks, locally and deployed alike:

```sh
curl http://localhost:3000/api/health
curl -N http://localhost:3000/api/health/stream
```

The first answers `{"status":"ok","database":"PostgreSQL 18.6 ..."}` — the engine's own
answer to `select version()`, so a route that never reached the database has nothing to
put there — and 503 rather than a crash when the database cannot be reached. The second
beats a frame a second as a server-sent event through `apps/api/src/lib/stream`, ends
itself after two minutes and stops the moment the reader goes. `pnpm test:e2e` asks the
same questions of the local stack.

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
which builds the bundle, deploys the stacks, migrates, and then checks what it
deployed: `pnpm test:e2e:deployed` against `https://dev.job-application.app`, two specs
that drive the deployed API and read its stream raw and never open a page. A failure
there fails the deploy, which is what keeps CloudFormation reporting success from being
mistaken for the environment working.

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
pnpm test:e2e            # the end-to-end checks against your local stack, at the API
pnpm test:e2e:deployed   # the same, against the development address; the deploy job runs it
```

`pnpm check` already runs the tests in `infra/tests`: the invariants of rule 17 — no NAT
gateway, no API Gateway, no RDS proxy, no VPC at all, compression off on `/api/*` — and
the one that keeps an API error an error: the distribution maps only a bucket's 403 to
the page, never a 404, so `/api/<unknown>` answers 404 and JSON rather than
`index.html` and 200. Each was proven to bite by making the violation and watching the
test go red. `cfn-lint` is a Python tool and is the one check `pnpm check` leaves to CI,
so that a laptop with only Node on it can still run everything else.

## The layout

```text
apps/web      Angular 22, standalone, signals, zoneless; an empty shell today
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
