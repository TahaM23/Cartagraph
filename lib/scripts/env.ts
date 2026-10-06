// The web app's environment, for scripts that run without it.
//
// Next reads .env files itself, in its own order (.env.$(NODE_ENV).local,
// .env.local, .env.$(NODE_ENV), .env), and never overrides a variable that is
// already set. This uses Next's own loader, so a script sees exactly what
// `next dev` would: not a second reading of the same files that could drift.
//
// Import it first, before anything that reads the environment as it loads:
// imports run in order, and tracing is decided when lib/ai/client.ts's
// callers are defined.
//
//   import "../lib/scripts/env.ts";

import path from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

/** The directory next.config.ts sits in, which is where Next looks. */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// A script is development unless it says otherwise, as `next dev` is.
nextEnv.loadEnvConfig(root, process.env.NODE_ENV !== "production", { info() {}, error: console.error });
