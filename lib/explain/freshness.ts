// Whether an analysis still describes the repository.
//
// The analysed commit is compared with the default branch's head. When they
// differ and a file is being explained, that file's bytes at the head are
// hashed and compared with the hash the parser stored, which tells "the
// repository moved on" apart from "this file changed".

import { createHash } from "node:crypto";
import { fetchFileAt, resolveCommit, type RepositoryRef } from "../pipeline/github.ts";
import type { Freshness } from "./types.ts";

/**
 * Asking for the head spends GitHub's unauthenticated API allowance, which is
 * small. Within this long, the last answer for a repository is reused.
 */
const HEAD_TTL_MS = 60_000;
const heads = new Map<string, { sha: string; at: number }>();

async function headOf(repo: RepositoryRef): Promise<string> {
  const id = `${repo.owner}/${repo.name}`;
  const known = heads.get(id);
  if (known && Date.now() - known.at < HEAD_TTL_MS) return known.sha;
  const sha = await resolveCommit(repo);
  heads.set(id, { sha, at: Date.now() });
  return sha;
}

export async function freshness(
  repo: RepositoryRef,
  commit: string,
  file: { path: string; hash: string | null } | null,
): Promise<Freshness> {
  try {
    const head = await headOf(repo);
    if (head === commit) return { state: "current", commit };
    if (!file) return { state: "moved", commit, head, file: null };
    const bytes = await fetchFileAt(repo, head, file.path);
    if (bytes === null) return { state: "moved", commit, head, file: "deleted" };
    const hash = createHash("sha256").update(bytes).digest("hex");
    return { state: "moved", commit, head, file: hash === file.hash ? "unchanged" : "changed" };
  } catch (error) {
    return {
      state: "unknown",
      commit,
      reason: error instanceof Error ? error.message : "GitHub could not be asked.",
    };
  }
}
