/**
 * The `fetch` that answers this application's own address in this process.
 *
 * The deployed function is configured with a base URL that is an address of this very
 * application. Put on a socket, that call would leave the function, cross the
 * distribution, and invoke the same function a second time for an answer this process
 * already has: a nested invocation, a second slice of one timeout, and an outbound
 * request the signed origin would demand a payload hash for.
 *
 * **The condition is "is this address mine", not which environment this is** (`ID130`,
 * `ID150`; the person, 2026-09-12: *"I just dont like environement conditions in the
 * code"*). It is the same question the web app's own client answers by sending to the
 * page's origin. Nothing here asks what is behind the address, so a base URL pointing
 * anywhere else is dialled as any address is, and pointing it at a provider is a change
 * of configuration rather than of code.
 */

/** How a request is put on the wire, as `AiConfig` takes it. */
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OwnAddress = {
  /** This application's own origin, as `APP_URL` states it. */
  origin: string;
  /** This application answering, given the request it would have been sent. */
  answer: (request: Request) => Promise<Response>;
  /** Every address that is not this one, put on the wire. */
  otherwise: Fetch;
};

/**
 * A `fetch` that dispatches to `answer` when the address is this application's, and to
 * `otherwise` when it is not.
 *
 * The request is built once and handed over whole, so what the handler reads is what a
 * server would have received: the method, the headers and the body as they were.
 */
export const answeringOwnAddress =
  ({ origin, answer, otherwise }: OwnAddress): Fetch =>
  async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    return new URL(request.url).origin === origin ? answer(request) : otherwise(input, init);
  };
