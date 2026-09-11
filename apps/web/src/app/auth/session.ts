import { inject } from "@angular/core";
import { type CanActivateFn, Router } from "@angular/router";
import { authClient } from "./auth-client";

/**
 * Who is signed in (ID74), and the two guards that follow from it.
 *
 * The session cookie is HttpOnly, so nothing here can read it, and "signed in" is only
 * ever what the library answers: `get-session` for the person, `list-accounts` for the
 * providers linked to them (F1: the library's session records no provider, so which one
 * signed you in is not knowable at its defaults, D20; which ones are linked is). Both
 * go through the library's own client and nothing else (ID59: no `/api/me`).
 *
 * Nothing is remembered between calls. A sign-out is seen by the very next `session()`,
 * and a guard that read a flag in storage or in the address would take a failed
 * sign-in's `?error=` for a person arriving.
 */

export type Provider = "google" | "microsoft" | "linkedin";

export type SignedIn = { name: string; email: string; providers: Provider[] };

const providers: readonly string[] = ["google", "microsoft", "linkedin"];

/** Whether a string the library or the address hands over names one of the three. */
export const isProvider = (id: string): id is Provider => providers.includes(id);

/**
 * The person the library answers for now, or null with no session. Rejects when the
 * library cannot be reached, which is not the same as no session: the guards below
 * choose what to make of that.
 */
export const session = async (): Promise<SignedIn | null> => {
  const who = await authClient.getSession();
  if (who.error) {
    throw new Error(`the library did not answer who is signed in: ${who.error.message}`);
  }
  if (who.data === null) {
    return null;
  }
  const accounts = await authClient.listAccounts();
  if (accounts.error) {
    throw new Error(`the library did not list the accounts: ${accounts.error.message}`);
  }
  const linked = [...accounts.data]
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((account) => account.providerId)
    .filter(isProvider);
  return { name: who.data.user.name, email: who.data.user.email, providers: linked };
};

/** The session, or null when there is none or the library cannot be reached. */
const sessionOrNone = (): Promise<SignedIn | null> => session().catch(() => null);

/** No session: the entry route. Otherwise the route renders. */
export const signedIn: CanActivateFn = () => {
  const router = inject(Router);
  return sessionOrNone().then((who) => (who === null ? router.createUrlTree(["/"]) : true));
};

/** A live session: `/profile`. Otherwise the route renders. */
export const signedOut: CanActivateFn = () => {
  const router = inject(Router);
  return sessionOrNone().then((who) => (who === null ? true : router.createUrlTree(["/profile"])));
};
