import type { Routes } from "@angular/router";

/**
 * The application's routes. There is one screen so far, the latest run, and the root
 * leads to it: nothing else is worth landing on yet. The page is loaded on demand, so
 * the shell stays the shell the day a second screen arrives.
 */
export const routes: Routes = [
  {
    path: "runs",
    loadComponent: async () => (await import("./runs/runs-page")).RunsPage,
    title: "Latest run",
  },
  { path: "", pathMatch: "full", redirectTo: "runs" },
];
