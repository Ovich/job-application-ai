import { fileURLToPath } from "node:url";

/**
 * What the local and the dev model says: this project's own answers, by feature, under
 * `./documents/` (`ID295`). They are data the mock is pointed at, not part of it.
 *
 * The folder is resolved beside this file, so the path holds in source and in the bundle
 * alike: the bundle is one flat file with `documents/` copied next to it.
 */
export const mockAnswers: string = fileURLToPath(new URL("./documents/", import.meta.url));
