// The preview's data: one parser run, checked into the repository so the
// interface can be built with no account, database or network. Scaffolding;
// it goes once analyses are stored. Regenerate with
//
//   pnpm parse <directory> --out data/preview.json
//
// Imported rather than read from disk so the bundler ships it with the route.
// It goes through the same validation as any other read of a parse result.

import { ParseResult } from "@/lib/parser/contract.ts";
import { checkInvariants } from "@/lib/parser/io.ts";
import raw from "@/data/preview.json";

function load(): ParseResult {
  const result = ParseResult.parse(raw);
  const problems = checkInvariants(result);
  if (problems.length > 0) {
    throw new Error(`data/preview.json is not a consistent parse result:\n- ${problems.join("\n- ")}`);
  }
  return result;
}

export const preview = load();
