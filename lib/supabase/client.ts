"use client";

import { useSession } from "@clerk/nextjs";
import { createClient } from "@supabase/supabase-js";
import { useMemo } from "react";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// Browser Supabase client that sends the current Clerk session token with
// every request. getToken() returns a fresh token, including after an
// organization switch.
export function useSupabase() {
  const { session } = useSession();
  return useMemo(
    () =>
      createClient<Database>(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
        accessToken: async () => (await session?.getToken()) ?? null,
      }),
    [session],
  );
}
