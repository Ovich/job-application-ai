import { type ApplicationConfig, mergeApplicationConfig } from "@angular/core";
import { provideServerRendering, withRoutes } from "@angular/ssr";
import { appConfig } from "./app.config";
import { serverRoutes } from "./app.routes.server";

/**
 * The server's providers on top of the browser's (ID77), as the Angular CLI lays them
 * out: the same application, rendered by the build with the server routes. Nothing
 * serves it at runtime; with `outputMode: "static"` the build renders the entry route
 * once, writes it as real HTML and stops (ID63).
 */
const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering(withRoutes(serverRoutes))],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
