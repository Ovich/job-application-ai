import { mergeApplicationConfig } from "@angular/core";
import { type BootstrapContext, bootstrapApplication } from "@angular/platform-browser";
import { provideServerRendering, withRoutes } from "@angular/ssr";
import { App } from "./app/app";
import { appConfig } from "./app/app.config";
import { serverRoutes } from "./app/app.routes.server";

/**
 * The server entry (ID77): the same application, bootstrapped for the build's renderer
 * with the browser's own providers and the server routes on top. Nothing serves this at
 * runtime; with `outputMode: "static"` the build runs it once, writes the entry route
 * as real HTML and stops (ID63). The prerendered `/` is the seam it is proved through.
 */
const bootstrap = (context: BootstrapContext) =>
  bootstrapApplication(
    App,
    mergeApplicationConfig(appConfig, {
      providers: [provideServerRendering(withRoutes(serverRoutes))],
    }),
    context,
  );

export default bootstrap;
