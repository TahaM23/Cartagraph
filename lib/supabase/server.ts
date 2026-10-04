import { auth } from "@clerk/nextjs/server";
import { createClient } from "@supabase/supabase-js";
import { publicEnv } from "@/lib/env";

// Supabase client for server components, actions and route handlers. Every
// request carries the signed-in user's Clerk session token, so RLS policies
// can read its claims (sub, o.id, role). Sessions are owned by Clerk; this
// client never persists or refreshes a Supabase session of its own.
export async function createServerSupabase() {
  const { getToken } = await auth();
  return createClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    accessToken: async () => (await getToken()) ?? null,
  });
}
