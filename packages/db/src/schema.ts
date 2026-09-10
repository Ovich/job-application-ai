/**
 * The database schema: every table the product has, and the single source of truth for
 * every data shape above it. Types flow from here through `@app/db` into the API's
 * `AppType` and from there into the web app, so a shape written here is never written
 * again anywhere.
 *
 * It is empty, and that is the state SL10 left it in. The two tables that stood here, a
 * run and the units it was made of, were invented in slice 1 to have something to
 * deploy, and D20 removed them with the rest of the fake domain: if nothing on `main`
 * calls it, it does not live on `main`. They are kept at the tag `foundation-skeleton`,
 * for a slice that wants the resume-on-(run, sequence) pattern back.
 *
 * The first real table is D11's `message`, which arrives with the conversation.
 */
export {};
