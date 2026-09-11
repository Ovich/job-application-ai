import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from "@angular/core";
import { provideClientHydration } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { routes } from "./app.routes";

/**
 * The application's providers. Angular 22 is zoneless by default, so there is no change
 * detection provider here and no zone.js in the dependencies: rendering is driven by
 * signals alone. The prerendered entry route is hydrated rather than redrawn: the browser
 * takes over the HTML the build wrote, as the CLI sets up an application with SSR.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideClientHydration(),
  ],
};
