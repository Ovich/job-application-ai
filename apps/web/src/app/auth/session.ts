/**
 * The shape of a signed-in person (ID74): the name, the address and the providers
 * linked to them, oldest first. Who that is right now is `CurrentUser`'s to ask
 * (`current-user.ts`, ID99); this file holds only the types every caller shares.
 */

export type Provider = "google" | "microsoft" | "linkedin";

export type SignedIn = { name: string; email: string; providers: Provider[] };

const providers: readonly string[] = ["google", "microsoft", "linkedin"];

/** Whether a string the library or the address hands over names one of the three. */
export const isProvider = (id: string): id is Provider => providers.includes(id);
