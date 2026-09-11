import type { Routes } from "@angular/router";
import { signedIn, signedOut } from "./auth/current-user";

/**
 * The application's routes (ID73): `/` is the entry route and `/profile` the shell,
 * each behind one of `auth/current-user`'s guards, so a live session skips the entry route
 * and no session leaves the shell for it. No logic on either line.
 */
export const routes: Routes = [
  {
    path: "",
    canActivate: [signedOut],
    loadComponent: () => import("./auth/sign-in/sign-in").then((m) => m.AppSignIn),
  },
  {
    path: "profile",
    canActivate: [signedIn],
    loadComponent: () => import("./shell/app-shell/app-shell").then((m) => m.AppShell),
  },
];
