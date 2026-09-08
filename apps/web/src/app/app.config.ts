import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from "@angular/core";
import { provideRouter } from "@angular/router";
import { routes } from "./app.routes";

/**
 * The application's providers. Angular 22 is zoneless by default, so there is no change
 * detection provider here and no zone.js in the dependencies: rendering is driven by
 * signals alone.
 */
export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(routes)],
};
