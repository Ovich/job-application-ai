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
        loadComponent: () => import("./intake/documents/documents").then((m) => m.AppDocuments),
      },
    ],
  },
];
