import { RenderMode, type ServerRoute } from "@angular/ssr";

/**
 * Which routes the build renders to HTML (ID77). Only `/`: the entry route is the
 * product's indexable surface (US6), and it is what a crawler receives with no
 * JavaScript. The signed-in routes stay client-side, since a prerender of them would
 * draw a bar for nobody: who is signed in is only known in the browser (ID74).
 */
export const serverRoutes: ServerRoute[] = [
  { path: "", renderMode: RenderMode.Prerender },
  { path: "**", renderMode: RenderMode.Client },
];
