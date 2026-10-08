// Every variable the app needs to boot. `checkEnv()` runs from next.config.ts,
// so a missing value stops `next dev` / `next build` instead of surfacing
// later as a confusing runtime error.
const REQUIRED = [
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_SIGN_IN_URL",
  "NEXT_PUBLIC_CLERK_SIGN_UP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  // Server-only; the pipeline writes with it (lib/supabase/admin.ts).
  "SUPABASE_SECRET_KEY",
] as const;

export function checkEnv() {
  const missing = REQUIRED.filter((name) => !process.env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n  ${missing.join("\n  ")}\n` +
        "Set them in .env.local (or the deployment environment) and restart.",
    );
  }
}

function required(name: string, value: string | undefined) {
  if (!value?.trim()) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

// Client-safe values. Each is referenced literally so Next can inline it into
// the browser bundle.
export const publicEnv = {
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseKey: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  ),
};
