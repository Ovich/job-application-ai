import type { Routes } from "@angular/router";

/**
 * The application's routes. The root is the sign-in page, bare for now: SL3 draws the
 * entry route in its place, and the signed-in screens arrive with their slots.
 */
export const routes: Routes = [
  { path: "", loadComponent: () => import("./auth/sign-in").then((m) => m.SignIn) },
];
