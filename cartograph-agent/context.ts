// What a run carries besides the conversation.
//
// The app puts the signed credential here when it starts a run. It names
// exactly one analysis and its organization, and the tools forward it as a
// bearer token. It never enters the prompt, so the model never sees which
// analysis it is reading and nothing in a repository's code can talk it into
// reading another one.

import { z } from "zod";

export const Context = z.object({
  /** Short-lived, signed by the app. Optional so a run without one says so instead of failing to start. */
  credential: z.string().optional(),
});
