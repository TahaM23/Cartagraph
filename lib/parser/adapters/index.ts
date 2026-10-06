// Every framework adapter, in the order detection tries them. The first to
// detect a repository is the one that applies, so the order is a decision:
//
// - NestJS first. A repository holding a Nest API and a web client is read
//   as its API, whose controllers and routes are the denser structure.
// - Next.js and Docusaurus before React, since both are React underneath and
//   know strictly more about their files.
// - Express after Next.js, which a custom Express server can sit in front of,
//   and before React, for the reason NestJS comes first: a repository holding
//   an Express API and a React client is read as its API.
// - Vite last: it knows how an app starts, and nothing about its files.

import type { FrameworkAdapter } from "../adapter.ts";
import { docusaurusAdapter } from "./docusaurus.ts";
import { expressAdapter } from "./express.ts";
import { nestjsAdapter } from "./nestjs.ts";
import { nextjsAdapter } from "./nextjs.ts";
import { reactAdapter } from "./react.ts";
import { viteAdapter } from "./vite.ts";

export const ADAPTERS: readonly FrameworkAdapter[] = [
  nestjsAdapter,
  nextjsAdapter,
  docusaurusAdapter,
  expressAdapter,
  reactAdapter,
  viteAdapter,
];
