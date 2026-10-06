// A retired file-explanation prompt, kept only so the current one has
// something to be measured against. It lives with the evaluations, not in the
// application: shipping a dead prompt so a test can reach it would be the
// test shaping the product.
//
// Version 0: the first, plain draft, before the rules version 1 added. It has
// no grounding paragraph (no "the lists are complete; never name a file you
// were not given"), no instruction to lead with what matters or not to restate
// the lists, no length in words, and no formatting rules. It is reconstructed
// rather than recovered: version 1 is the only one ever committed.
//
// It takes the same input as version 1 (lib/explain/prompt.ts, fileInput), so
// a comparison measures the instructions and nothing else.

export const FILE_INSTRUCTIONS_V0 = `You are an expert software engineer. Explain the file below, from a TypeScript or JavaScript repository, to a developer who is new to the codebase.

Describe what the file does and how it fits in with the files it imports and the files that import it. Keep it concise: one or two short paragraphs.`;
