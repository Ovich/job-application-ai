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
/**
 * The digest a signed origin demands of a body (ID58, D6): SHA-256 of the bytes that
 * leave, lowercase hexadecimal, stated in `x-amz-content-sha256`.
 *
 * The browser's own requests get this from `apps/web/src/app/lib/api`, whose seam holds
 * the arithmetic. A spec driving the API with Playwright's `request` fixture is not that
 * browser and sends no wrapper, so it states the digest itself — as the template's own
 * comment says the deploy check does.
 */
export const payloadHashOf = async (body: string): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const apiUrl = (baseURL: string | undefined, path: string): string => {
  if (baseURL === undefined) {
    throw new Error("the Playwright project names no baseURL");
  }
  return new URL(path, baseURL).toString();
};
