# AGENTS.md

Conventions of this repository: the decisions a fresh agent would otherwise guess
differently. The boundaries a tool can enforce live in the tool (`biome.json`, the tests,
`pnpm check`); a rule here is one that needs judgment, or one a generator gets wrong.

A rule may be deviated from at a specific site with a comment beginning
`AGENTS EXCEPTION (rule N):` and the reason; without one, deviation is a review finding.
When a decision made during a session would pass the five filters of the
`project-conventions` skill (contested, recurring, consequential, checkable, not
tool-enforceable), say so in chat before the session ends and propose the rule; it is
written here only on the person's yes.

## Web app (Angular, `apps/web`)

Read against Angular 22's style guide, https://angular.dev/style-guide.

1. **MUST put every component's template in its own file, and so every component in its own folder.** `templateUrl: "./<name>.html"`, the class and the template side by side in `<name>/`, the Angular CLI's layout (`apps/web/src/app/shell/app-bar/`). An inline template has no highlighting, no formatting and no lint.

2. **MUST name a component's or a directive's class after its selector, in PascalCase.** The tag `app-notice` is `AppNotice`, the attribute `[uiStack]` is `UiStack`, so a name read in a template is the name to search for. `ng g c notice` still writes `Notice`: rename it. Departs from the style guide's bare class names; `tests/conventions/selectors.test.ts` fails the build on a mismatch.

3. **MUST give a template only its own component's members, its state as signals; a template never reaches an injected service or client.** A constant or a pure method stays plain. The class reads the service and exposes signals, computeds and inputs the template binds to, so the template is tested by state without the network, and a service's shape changes in one place. `AppShell` reads the session and hands `AppBar` a `user` input (`apps/web/src/app/shell/`).

4. **MUST end a full-page component's class with `Page`, and so its selector with `-page` (rule 2).** A full page is what a route renders into an outlet (`apps/web/src/app/app.routes.ts`); a layout such as `AppShell`, or a section of a page, is not one. Without the suffix, a page and its own section compete for one name, as `ProfileViewer` did.

## API (`apps/api`)

5. **MUST keep the model mock inside `apps/api/src/lib/mock`; outside it, only the route binding it (`apps/api/src/routes/mock.ts`, mounted by `app.ts`) and the answers it is pointed at (`apps/api/src/mock-answers`) know a mock exists.** No handler, assistant, agent, client or web code branches on, names, or shapes a request for the mock: they call the model as production does, and the mock answers the same wire, its own delays included. A local run then shows what production shows, the loader during a slow answer included, with nothing injected for development.

6. **MUST keep `apps/api/src/lib/mock` extractable as a library: `index.ts` is its only entry, and nothing under it imports from the application, reads the environment, or names this product.** Its surface is the `ModelMock` class (`fetch`, `use`, `requests`, `reset`); a header name, a pace or a folder is an option the binding passes. Web-standard `Request`, `Response` and streams only, no framework. It may be published one day; until then the folder moves to `packages/` unchanged.

7. **MUST build the conversation agent in one place, the composition root (`apps/api/src/app.ts`), and hand it to what uses it.** Only that binding knows which model, store, transaction and header name the agent is made of; a handler calls `agent.run(...)` and an assistant contributes a definition, and neither imports `lib/ai`, `lib/db` or a LangChain package to reach a model.

8. **MUST keep `apps/api/src/lib/agent` extractable as a library, as rule 6 keeps the mock: `index.ts` is its only entry, and nothing under it imports from the application, reads the environment, or names this product.** Its surface is the `ConversationAgent` class (`run`, `steps`) and the types a definition is written against; the model, the store and the transaction are options the binding passes. `apps/api/tests/lib/agent/boundary.test.ts` holds it.
