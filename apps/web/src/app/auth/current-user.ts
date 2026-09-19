import { Injectable, inject, signal } from "@angular/core";
import { type CanActivateFn, type CanMatchFn, Router, type UrlTree } from "@angular/router";
import { authClient } from "./auth-client";
import { isProvider, type SignedIn } from "./session";

/** The deletion while it is open: whether the library is being asked, and whether it refused. */
export type Deletion = { working: boolean; failed: boolean };

/**
 * The person signed in, and everything done as them (ID99, replacing ID74's `session()`):
 * who it is, signing out, deleting the account, and every place those send the browser,
 * decided here and nowhere else: no session goes to `/`, a sign-out goes to `/`, a
 * deletion goes to `/?deleted` (F8). The guards, the shell and through it the bar's menu
 * all go through this service; a template never reaches it (AGENTS.md rule 3), its
 * component reads the signals below.
 *
 * The session cookie is HttpOnly, so nothing here can read it, and "signed in" is only
 * ever what the library answers: `get-session` for the person, `list-accounts` for the
 * providers linked to them (F1: the library's session records no provider, so which one
 * signed you in is not knowable at its defaults, D20; which ones are linked is). Both go
 * through the library's own client and nothing else (ID59: no `/api/me`). `person` is
 * only what the library said last; every guard and every opening of the deletion asks
 * again, so a sign-out elsewhere is seen at the next one, and nothing is kept in storage
 * or read from the address.
 */
@Injectable({ providedIn: "root" })
export class CurrentUser {
  private readonly router = inject(Router);

  private readonly who = signal<SignedIn | null>(null);

  private readonly deleting = signal<Deletion | null>(null);

  /** The person the library last answered for, or null. */
  public readonly person = this.who.asReadonly();

  /** The deletion while it is open, or null when it is closed. */
  public readonly deletion = this.deleting.asReadonly();

  /**
   * Asks the library who is signed in now and holds the answer: the person, or null with
   * no session. Rejects when the library cannot be reached, which is not the same as no
   * session: each caller below decides what to make of that.
   */
  public async refresh(): Promise<SignedIn | null> {
    const session = await authClient.getSession();
    if (session.error) {
      throw new Error(`the library did not answer who is signed in: ${session.error.message}`);
    }
    if (session.data === null) {
      this.who.set(null);
      return null;
    }
    const accounts = await authClient.listAccounts();
    if (accounts.error) {
      throw new Error(`the library did not list the accounts: ${accounts.error.message}`);
    }
    const providers = [...accounts.data]
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      .map((account) => account.providerId)
      .filter(isProvider);
    const person = { name: session.data.user.name, email: session.data.user.email, providers };
    this.who.set(person);
    return person;
  }

  /** `/profile`'s guard: the route renders for a person, and no session goes to `/`. */
  public async admitSignedIn(): Promise<true | UrlTree> {
    return (await this.refreshOrNone()) === null ? this.router.createUrlTree(["/"]) : true;
  }

  /**
   * `/`'s index branch (D19): `/` renders the index for a person, and for no session the
   * branch does not match at all, so the route table falls through to the sign-in screen
   * written below it. A `canMatch` and not a `canActivate`, because one address now has
   * two entries and only a match that can fail lets the second one be tried.
   */
  public async admitsIndex(): Promise<boolean> {
    return (await this.refreshOrNone()) !== null;
  }

  /**
   * `/`'s sign-in branch: it renders with no session. A person never reaches it, since
   * the index branch above it matched first; the redirect stays as the answer for a
   * browser that somehow gets here with a live session.
   */
  public async admitSignedOut(): Promise<true | UrlTree> {
    return (await this.refreshOrNone()) === null ? true : this.router.createUrlTree(["/profile"]);
  }

  /**
   * Signs out through the library, then the entry route. A sign-out the library refuses
   * leaves the person where they are, still signed in, and nothing is reported in this slot.
   */
  public async signOut(): Promise<void> {
    const { error } = await authClient.signOut();
    if (error) {
      return;
    }
    this.who.set(null);
    await this.router.navigateByUrl("/");
  }

  /**
   * Opens the deletion (ID84): the person is asked for again, so what it says goes is read
   * at open. No session, or no library, is the guards' answer: the entry route.
   */
  public async openDeletion(): Promise<void> {
    if ((await this.refreshOrNone()) === null) {
      await this.router.navigateByUrl("/");
      return;
    }
    this.deleting.set({ working: false, failed: false });
  }

  /** Closes the deletion, unless the library is being asked. */
  public closeDeletion(): void {
    if (this.deleting()?.working !== true) {
      this.deleting.set(null);
    }
  }

  /**
   * Deletes the account through the library's client (ID70), then `/?deleted`. The library
   * clears the cookie itself, so nothing signs out after it. A refusal, or no library,
   * keeps the deletion open and failed, the person still signed in where they are.
   */
  public async deleteAccount(): Promise<void> {
    this.deleting.set({ working: true, failed: false });
    const deleted = await authClient.deleteUser().then(
      ({ error }) => error === null,
      () => false,
    );
    if (!deleted) {
      this.deleting.set({ working: false, failed: true });
      return;
    }
    this.who.set(null);
    await this.router.navigateByUrl("/?deleted");
    this.deleting.set(null);
  }

  /** The person, or null when there is none or the library cannot be reached. */
  private refreshOrNone(): Promise<SignedIn | null> {
    return this.refresh().catch(() => null);
  }
}

/** No session: the entry route. Otherwise the route renders. */
export const signedIn: CanActivateFn = () => inject(CurrentUser).admitSignedIn();

/** A live session: `/profile`. Otherwise the route renders. */
export const signedOut: CanActivateFn = () => inject(CurrentUser).admitSignedOut();

/** A live session: `/` is the index. No session: this branch is not the one, try the next. */
export const hasSession: CanMatchFn = () => inject(CurrentUser).admitsIndex();
