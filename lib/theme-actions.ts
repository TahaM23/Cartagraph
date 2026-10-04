"use server";

import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

export async function saveTheme(value: string) {
  (await cookies()).set(THEME_COOKIE, parseTheme(value), {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
