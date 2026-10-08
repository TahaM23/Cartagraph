// The cache in front of every model call, keyed on content.
//
// A key is the sha256 of everything that decides the answer: what kind of
// question, the exact model, the prompt's version, and the content of the
// thing asked about (file hashes, the paths and pairs it was shown). Change
// any of them and the key changes; change none and the answer is reused,
// across re-runs and across analyses of the same code.
//
// Reads take whichever client the caller has (the signed-in user's, so
// row-level security applies). Writes take the secret-key client: members
// cannot write here, so nothing in the cache was put there by anything but a
// model's answer.

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdminSupabase } from "../supabase/admin.ts";
import type { Database } from "../supabase/database.types.ts";
import { traced } from "./client.ts";

type Db = SupabaseClient<Database>;

/** sha256 of a value's JSON. Callers build the value in a fixed order (sorted lists), so equal content gives an equal key. */
export function cacheKey(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export interface CachedExplanation {
  body: string;
  model: string;
}

/** Recorded as its own step, so a trace shows the lookup, and whether it hit, ahead of any model call. */
export const readExplanation = traced(
  "cache lookup",
  async (db: Db, orgId: string, key: string): Promise<CachedExplanation | null> => {
    const { data, error } = await db
      .from("explanations")
      .select("body, model")
      .eq("org_id", orgId)
      .eq("cache_key", key)
      .maybeSingle();
    if (error) throw new Error(`Reading the explanation cache failed: ${error.message}`);
    return data;
  },
  {
    run_type: "retriever",
    processInputs: (inputs) => ({ key: (inputs as { args: [Db, string, string] }).args[2] }),
    processOutputs: (outputs) => ({ hit: (outputs as { outputs: CachedExplanation | null }).outputs !== null }),
  },
);

export async function writeExplanation(
  admin: AdminSupabase,
  row: { orgId: string; key: string; subject: "file" | "folder"; model: string; body: string },
): Promise<void> {
  const { error } = await admin.from("explanations").upsert(
    { org_id: row.orgId, cache_key: row.key, subject: row.subject, model: row.model, body: row.body },
    { onConflict: "org_id,cache_key", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Writing the explanation cache failed: ${error.message}`);
}

/** Keys are hex, 64 characters; this many fit comfortably in one request's URL. */
const KEYS_PER_READ = 100;

/**
 * The cached role for each key that has one. The pipeline reads with the
 * secret key, which row-level security does not apply to, so the
 * organization is filtered on here.
 */
export async function readRoleLabels(db: Db, orgId: string, keys: readonly string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (let i = 0; i < keys.length; i += KEYS_PER_READ) {
    const { data, error } = await db
      .from("role_labels")
      .select("cache_key, role")
      .eq("org_id", orgId)
      .in("cache_key", keys.slice(i, i + KEYS_PER_READ));
    if (error) throw new Error(`Reading the role label cache failed: ${error.message}`);
    for (const row of data) found.set(row.cache_key, row.role);
  }
  return found;
}

export async function writeRoleLabels(
  admin: AdminSupabase,
  orgId: string,
  model: string,
  labels: readonly { key: string; role: string }[],
): Promise<void> {
  if (labels.length === 0) return;
  const { error } = await admin.from("role_labels").upsert(
    labels.map((l) => ({ org_id: orgId, cache_key: l.key, model, role: l.role })),
    { onConflict: "org_id,cache_key", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Writing the role label cache failed: ${error.message}`);
}
