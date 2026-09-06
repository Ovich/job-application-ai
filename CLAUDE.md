# CLAUDE.md

Instructions for any AI agent (Claude Code, Cursor, Codex, …) working in this repo.
Read this before writing or changing code. Review enforces these rules; follow them, don't rationalize exceptions.

The one escape hatch: when a rule is genuinely unreasonable for a specific piece of code, mark the site with a comment starting `AGENTS EXCEPTION (rule N):`, followed by short reasoning and, when possible, the condition under which to revisit it. A deviation without this marker is a review finding; so is a marker whose reasoning doesn't hold up.

Capture clause: when a decision made during a session would pass the five filters of the project-conventions skill (contested, recurring, consequential, checkable, not tool-enforceable), say so in chat before the session ends and propose the rule. It is written here only on the person's yes. Numbering is append-only; never renumber.

## Architecture (context you must not break)

- **job-application.app**: the AI job-seeker platform. A job seeker builds one profile from every CV they have, then, per job offer, a tailored CV and cover letter through one conversation that never invents a claim. Product roadmap and foundation decisions live outside this repo (aiview, project JOBS); this file carries only what the code must obey.
- pnpm monorepo. `apps/web` = Angular 22 SPA (standalone, signals, zoneless, Vitest; spartan/ui on Angular CDK, Tailwind). `apps/api` = Hono on AWS Lambda (Drizzle, PostgreSQL). `packages/db` = the Drizzle schema, the single source of truth for data shapes. `infra` = AWS CDK v2, TypeScript, region eu-central-2 (Zurich).
- Type flow is **Drizzle → `@app/db` → `@app/api` (`AppType`) → `apps/web` (`InferResponseType`)**. Types are inferred across this whole chain; nothing is hand-maintained in parallel to it. No OpenAPI document, no generated client.
- No build step for `@app/db`: apps import its TypeScript source directly via the package `exports` field.
- The database is fully relational: no JSON columns. Raw AI output kept for audit goes to S3, never to a table.
- Streaming is a requirement: the main agent's replies stream to the chat over server-sent events, through Lambda response streaming.
- Cost posture: idle infrastructure under CHF 10 a month. Lambda outside any VPC, Aurora Serverless v2 paused when idle behind the Data API, function URL behind CloudFront, SQS for jobs. The AI tokens are the only cost that scales, and the ledger passes them on.
- Deploys come only from GitHub Actions: `dev` on every merge to `main`, `prod` on a tag. Nobody runs `cdk deploy` to prod from a laptop.
- Domain vocabulary, one word per concept everywhere (code, schema, UI, docs): **profile** (one per account), **item** (an experience, project, skill, education, language of the profile), **meta** (an item's role, scope, presentation, constraint), **provenance** (which source an item came from), **application** (one offer for one profile, with its documents and decisions), **offer** (the posting), **criterion** (one requirement extracted from the offer), **finding** (how the CV meets a criterion: met, not presented, gap), **tool** (a dock tool: Rework, Focus, Make room …), **change** (one applied tool result: before, after, cost), **structure** (pages and sections of the CV), **model** (the look of the CV), **ledger entry** (one debit or credit, in credits).

## Rules

1. **MUST NOT create a `packages/types` package or any shared hand-written type layer.** We use Drizzle inference end-to-end. A shared type file is where the second copy of a shape starts drifting.
2. **MUST derive DB-row types from Drizzle, never hand-write them.** Use `typeof <table>.$inferSelect` / `.$inferInsert`, or the named aliases exported from `@app/db`. Add a new alias there when a table is used widely. https://orm.drizzle.team/docs/goodies
3. **API response shapes MUST stay inferred.** Build handler responses as object literals projected from Drizzle query rows; do not annotate them with a hand-written response interface. The frontend gets the shape for free through the Hono RPC client. https://hono.dev/docs/guides/rpc
4. **Frontend MUST consume API types via the RPC client**, not by re-declaring them. Derive from `InferResponseType<typeof api.…$get, 200>` (see `apps/web/src/app/lib/api.ts`). `apps/web` must not depend on `@app/db` directly.
5. **Hand-written `type`/`interface` is only allowed when it does NOT duplicate a DB row**: external-API shapes (the AI provider), config/env, control-flow result unions, and UI-only view-models / component inputs. When in doubt, ask whether Drizzle already knows the shape; if yes, derive it.
6. **Input-validation schemas (zod) SHOULD stay linked to the schema.** Prefer `drizzle-zod` (`createInsertSchema`, `createUpdateSchema`) over hand-listing columns when validating writes, so validators can't drift from the table. https://orm.drizzle.team/docs/zod
7. **Calls to external services MUST live in a dedicated integration layer, never inline elsewhere.** Handlers and other lib code orchestrate named operations; they never touch a raw client or `fetch` an external API directly. The AI provider lives in `apps/api/src/lib/ai/`, one call + narrowing per function, no orchestration; every call there writes its token counts to the ledger. S3 lives in `apps/api/src/lib/storage/`. A future external service gets its own `lib/<service>/` on the same pattern.

## Database

8. **Migrations MUST carry a descriptive name.** Always generate with `pnpm --filter @app/db db:generate --name=<what_it_does>` (e.g. `items_provenance_source_id`). Without `--name`, drizzle-kit invents a random one (`0013_busy_valeria_richards`) that tells you nothing when you read the migration list to work out what shape the DB is in. https://orm.drizzle.team/docs/kit-overview
9. **Read the generated SQL before applying it.** drizzle-kit is a starting point, not an authority. On PostgreSQL it will not write the `USING` cast a column type change needs, it emits enum changes as drop-and-recreate that fail on a column in use, and it never writes the data BACKFILL a semantic change needs. Fix these in the generated file, and note in a comment that it was hand-edited and why. Migrations run at deploy from the pipeline, never by `drizzle-kit push`. https://orm.drizzle.team/docs/migrations

## API

10. **Routes wire, handlers do, lib shares.** A route file (`apps/api/src/routes/`) contains only paths and middleware mapped to named handlers, no logic. Handlers live in `apps/api/src/handlers/` and are built with `factory.createHandlers` so `c` keeps its inference (Hono's documented pattern, https://hono.dev/docs/guides/best-practices). A helper may be declared in the handler file that uses it; the moment a second file needs it, move it into `apps/api/src/lib/`. Never import from another handler file.
11. **A `lib/` module is a named unit, not merely shared code.** Sharing is one reason to live there, never the requirement: a single-caller module is fine when you reason about it on its own, with its own name, its own tests, its own reason to change. The test is whether inlining it into its one caller would bury a distinct concern somewhere nobody would look for it.
12. **Configuration MUST be read once, validated at boot, and typed from that validation.** `apps/api/src/env.ts` parses `process.env` with one zod schema and exports the result; nothing else reads `process.env`. A missing required value fails the cold start, never a request. Secrets reach the function through Secrets Manager references set by CDK, never through committed files.
13. **A request handler MUST NOT run an AI step that can take longer than a few seconds inline.** Long steps (reading the intake documents, precomputing rewrites) run as jobs the handler enqueues and the client observes; the streaming routes stream, they do not block. The exact runner is the foundation's decision; the rule is that a handler never awaits a minute.

## Frontend

14. **Fetch through the RPC client.** Use the `api` client from `apps/web/src/app/lib/api.ts` inside Angular `resource()` loaders, never `HttpClient` and never a hand-rolled `fetch`. Departs from Angular's `httpResource` guidance (https://angular.dev/guide/http/http-resource) because the response types come from `AppType`, which `HttpClient` cannot carry.
15. **Organise by feature, tests beside the code.** `apps/web/src/app/<feature>/` holds the components, routes and services of one feature; no `components/`, `services/` or `directives/` directories, per Angular's style guide (https://angular.dev/style-guide). One component, directive or service per file.
16. **If you must read an element's classes to know what it is, it needs a name.** Tailwind is low-level; the component name is where the meaning lives. Wrap any element whose purpose its utility string alone doesn't state in a component named for what it RENDERS (`CostLine`, `FindingRow`, `ToolPrefix`). When styling branches by state, each state becomes its own named component over one shared shell, never a ladder of `state === …` class conditionals. Long class strings survive only INSIDE leaf components, one per name. Exception: the spartan/ui `ui/` folder.

## Infrastructure

17. **MUST NOT add a fixed monthly cost line without a decision recorded in the foundation first.** No Lambda inside a VPC (it forces a NAT gateway, about CHF 35 a month), no RDS Proxy, no API Gateway in front of the API, no always-on database capacity. The database is Aurora Serverless v2 with automatic pause behind the RDS Data API; the API is a function URL behind CloudFront; jobs go through SQS. The posture is `foundation.reference.md` F15: idle infrastructure under CHF 10 a month, AI tokens the only cost that scales. https://docs.aws.amazon.com/cdk/v2/guide/best-practices.html

## Data protection

18. **Personal data MUST NOT be logged.** Log ids, counts, durations and outcomes, never a CV's text, a profile item's content, an offer's text or a person's name or email. A log line that would let a reader reconstruct a document is a review finding. Structured logs carry the request id and the account id only.
