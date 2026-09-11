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
