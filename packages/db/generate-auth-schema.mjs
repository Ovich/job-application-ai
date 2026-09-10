import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Regenerates `src/auth-schema.ts` from the API's authentication configuration.
 * `pnpm --filter @app/db db:generate:auth` runs it; a clean tree afterwards is the
 * proof the committed file is the generator's own output (ID56).
 *
 * The generator is the Better Auth CLI, and it reads `apps/api/src/lib/auth` to know
 * which tables to emit (ID56b); so it runs from `apps/api`, where that module and the
 * packages it imports resolve, and lives in that package's development dependencies.
 * Loading the module loads `apps/api/src/env.ts`, which refuses to start without a
 * Google client (ID60). The generation needs none: no request leaves this process, and
 * the emitted tables do not depend on the values. So the two keys are set for this
 * process only, to placeholders that say what they are, and a clean clone with no
 * `.env` can run the check. A `.env` that exists is left alone: the CLI loads it and
 * `dotenv` never overrides a value already set.
 */
const api = fileURLToPath(new URL("../../apps/api", import.meta.url));

// One string through the shell, because on Windows `pnpm` is `pnpm.cmd` and only a
// shell resolves that; nothing in the string comes from outside this file.
execSync(
  "pnpm exec better-auth generate --config src/lib/auth/index.ts --output ../../packages/db/src/auth-schema.ts --yes",
  {
    cwd: api,
    stdio: "inherit",
    env: {
      ...process.env,
      GOOGLE_CLIENT_ID: "placeholder-for-schema-generation",
      GOOGLE_CLIENT_SECRET: "placeholder-for-schema-generation",
    },
  },
);
