import { type BootstrapContext, bootstrapApplication } from "@angular/platform-browser";
import { AppRoot } from "./app/app";
import { config } from "./app/app.config.server";

/** The build's entry for the prerender (ID77): the application with the server's providers. */
const bootstrap = (context: BootstrapContext) => bootstrapApplication(AppRoot, config, context);

export default bootstrap;
