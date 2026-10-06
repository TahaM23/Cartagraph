import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types.ts";

export type AdminSupabase = SupabaseClient<Database>;

// Supabase client with the server's secret key, which bypasses row-level
// security. Only the pipeline uses it, because a run outlives the request
// that started it and the user's session token with it. It is handed a single
// analysis id and takes the organization from that row, never from a caller.
//
// Server-only: the key has no NEXT_PUBLIC_ prefix, so Next never inlines it
// into a browser bundle. Relative imports keep it usable from a plain script.
export function createAdminSupabase(): AdminSupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !key) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must both be set to run the pipeline.");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
