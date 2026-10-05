// Fetching a public GitHub repository as an archive. Unauthenticated, so no
// repository scope is requested and no token exists to be stored.
//
// The commit is resolved first and the archive is downloaded at that exact
// commit, so the recorded sha is the code that was parsed, not whatever the
// branch pointed at a moment later.

import fs from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import * as tar from "tar";
import { isSourceFile } from "../parser/walk.ts";

export interface RepositoryRef {
  owner: string;
  name: string;
}

/** Bigger than this compressed and the run stops before downloading. */
export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;

const OWNER = /^[A-Za-z0-9-]+$/;
const NAME = /^[A-Za-z0-9._-]+$/;

/** A failure whose message is fit to show the person who asked for the run. */
export class RunError extends Error {}

/**
 * Accepts `https://github.com/owner/name`, with or without the scheme, `www.`,
 * a trailing `.git`, or anything after the name (`/tree/main/src`), and the
 * bare `owner/name`. GitHub names are case-insensitive, so they are lowercased:
 * the same repository pasted twice in different case is one repository.
 */
export function parseRepositoryUrl(input: string): RepositoryRef | null {
  const rest = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^(www\.)?github\.com\//i, "");
  const [owner, rawName] = rest.split(/[/?#]/);
  const name = rawName?.replace(/\.git$/i, "");
  // Owners cannot contain a dot, so another host (gitlab.com/...) fails here.
  if (!owner || !name || !OWNER.test(owner) || !NAME.test(name)) return null;
  if (name === "." || name === "..") return null;
  return { owner: owner.toLowerCase(), name: name.toLowerCase() };
}

const label = ({ owner, name }: RepositoryRef) => `github.com/${owner}/${name}`;

const HEADERS = { "user-agent": "cartograph", "x-github-api-version": "2022-11-28" };

function rateLimitMessage(response: Response): string | null {
  if (response.status !== 403 && response.status !== 429) return null;
  if (response.headers.get("x-ratelimit-remaining") !== "0") return null;
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const when = Number.isFinite(reset) && reset > 0
    ? ` It resets at ${new Date(reset * 1000).toISOString().slice(11, 16)} UTC.`
    : "";
  return `GitHub's limit on unauthenticated requests from this server is used up.${when}`;
}

/** The full sha of the default branch's head. */
export async function resolveCommit(repo: RepositoryRef): Promise<string> {
  const url = `https://api.github.com/repos/${repo.owner}/${repo.name}/commits/HEAD`;
  const response = await fetch(url, {
    headers: { ...HEADERS, accept: "application/vnd.github.sha" },
  });

  if (response.ok) {
    const sha = (await response.text()).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new RunError(`GitHub answered with something that is not a commit sha for ${label(repo)}.`);
    }
    return sha;
  }

  const limited = rateLimitMessage(response);
  if (limited) throw new RunError(limited);
  if (response.status === 404) {
    throw new RunError(`${label(repo)} does not exist, or is not public.`);
  }
  if (response.status === 409) {
    throw new RunError(`${label(repo)} is empty: it has no commits to parse.`);
  }
  throw new RunError(`GitHub returned ${response.status} when asked for ${label(repo)}'s latest commit.`);
}

/** Non-source files larger than this are extracted empty. */
const MAX_OTHER_FILE_BYTES = 1024 * 1024;

/**
 * Whether a file is extracted with its contents. Source files always are (a
 * skipped one still reports its size and hash). Anything else is kept when
 * small, since adapters read configs and HTML, and extracted empty when large:
 * its existence still matters (an import of an image is an asset, not a
 * missing file), its bytes never do.
 */
function contentsNeeded(entryPath: string, size: number): boolean {
  return isSourceFile(entryPath.slice(entryPath.lastIndexOf("/") + 1)) || size <= MAX_OTHER_FILE_BYTES;
}

const discard = () =>
  new Transform({
    transform(_chunk, _encoding, callback) {
      callback();
    },
  });

/**
 * Downloads the archive at `sha` and extracts it into `directory`, with the
 * archive's top-level folder stripped so `directory` is the repository root.
 * Returns the archive's compressed size.
 */
export async function downloadArchive(
  repo: RepositoryRef,
  sha: string,
  directory: string,
): Promise<number> {
  const url = `https://codeload.github.com/${repo.owner}/${repo.name}/tar.gz/${sha}`;
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok || !response.body) {
    throw new RunError(`Downloading ${label(repo)} at ${sha.slice(0, 7)} failed: GitHub returned ${response.status}.`);
  }

  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_ARCHIVE_BYTES) {
    await response.body.cancel();
    throw new RunError(`${label(repo)}'s archive is over the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB limit.`);
  }

  fs.mkdirSync(directory, { recursive: true });
  let received = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > MAX_ARCHIVE_BYTES) {
        callback(new RunError(`${label(repo)}'s archive is over the ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB limit.`));
      } else {
        callback(null, chunk);
      }
    },
  });

  // tar refuses entries that would land outside `directory`, absolute paths
  // and writes through symlinks, and skips (with a warning, not a failure)
  // anything else it won't extract. Owners and modes are not kept.
  await pipeline(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
    limit,
    tar.x({
      cwd: directory,
      strip: 1,
      noChmod: true,
      preserveOwner: false,
      filter: (_path, entry) => "type" in entry && ["File", "Directory", "SymbolicLink"].includes(entry.type),
      transform: (entry) =>
        entry.type === "File" && !contentsNeeded(entry.path, entry.size)
          ? (discard() as unknown as tar.ReadEntry)
          : undefined,
    }),
  );
  return received;
}
