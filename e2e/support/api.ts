/**
 * Where the API is, at whichever address the Playwright project names.
 *
 * Both projects run the same specs against different front doors — the dev server's
 * proxy and the deployed distribution — so no spec writes a host, and the one place
 * that turns a path into an address is here. Playwright's `request` fixture resolves a
 * relative path against the project's `baseURL` by itself; a raw read of a stream
 * (`e2e/support/stream.ts`) uses the platform's `fetch`, which does not, and that is
 * what this exists for.
 */
export const apiUrl = (baseURL: string | undefined, path: string): string => {
  if (baseURL === undefined) {
    throw new Error("the Playwright project names no baseURL");
  }
  return new URL(path, baseURL).toString();
};
