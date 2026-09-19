import type { Routes } from "@angular/router";
import { hasSession, signedIn, signedOut } from "./auth/current-user";

/**
 * The application's routes (ID73): `/`, `/profile` and `/documents`, each behind one of
 * `auth/current-user`'s guards, so a live session sees the product and no session leaves
 * the shell for the sign-in screen. No logic on any line.
 *
 * `/` is two entries and not one (product-flow-rework S1.1, D19): the index for a person,
 * the sign-in screen for nobody. The first carries `canMatch` rather than `canActivate`,
 * because a `canActivate` that says no ends the navigation and what is wanted here is the
 * next entry for the same address. Order is the whole of it: the index is tried first, and
 * with no session it does not match, so the sign-in screen below is what renders. Which
 * also leaves the prerender (ID77) exactly what it was — nothing answers `get-session` on
 * a build machine, so `/` is still written out of the sign-in screen.
 */
export const routes: Routes = [
  {
    path: "",
    canMatch: [hasSession],
    loadComponent: () => import("./shell/app-shell/app-shell").then((m) => m.AppShell),
    children: [
      {
        path: "",
        loadComponent: () => import("./home/home-page/home-page").then((m) => m.HomePage),
      },
    ],
  },
  {
    path: "",
    canActivate: [signedOut],
    loadComponent: () => import("./auth/sign-in/sign-in").then((m) => m.AppSignIn),
  },
  // The viewer (SL3). `/profile` has been the shell with an empty outlet since the
  // foundation; this is the child that fills it. No logic on the line, and the guard is
  // the one that was already there.
  {
    path: "profile",
    canActivate: [signedIn],
    loadComponent: () => import("./shell/app-shell/app-shell").then((m) => m.AppShell),
    children: [
      {
        path: "",
        loadComponent: () =>
          import("./profile/profile-page/profile-page").then((m) => m.ProfilePage),
      },
    ],
  },
  // The intake (SL2, F4). The shell is the layout, so the documents screen has the
  // AppBar above it as the mockup draws it, and the screen itself renders in the
  // shell's outlet. `/profile` is untouched: it is still the shell with nothing in it
  // until the viewer arrives (SL3), which is also the slice `app.routes.ts` belongs to.
  {
    path: "documents",
    canActivate: [signedIn],
    loadComponent: () => import("./shell/app-shell/app-shell").then((m) => m.AppShell),
    children: [
      {
        path: "",
        loadComponent: () =>
          import("./intake/documents/documents-page/documents-page").then((m) => m.DocumentsPage),
      },
    ],
  },
];
