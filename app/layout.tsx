import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Cartograph",
  description: "Cartograph",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html
      lang="en"
      data-theme={theme === "system" ? undefined : theme}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-sans">
        <ClerkProvider
          appearance={{
            // Clerk's components read the app's colour tokens, so they follow
            // whichever theme is active.
            variables: {
              colorBackground: "var(--background)",
              colorForeground: "var(--foreground)",
              colorPrimary: "var(--foreground)",
              colorPrimaryForeground: "var(--background)",
              colorMuted: "var(--muted)",
              colorMutedForeground: "var(--muted-foreground)",
              colorInput: "var(--background)",
              colorInputForeground: "var(--foreground)",
              colorBorder: "var(--border)",
              colorNeutral: "var(--foreground)",
            },
          }}
        >
          {children}
        </ClerkProvider>
      </body>
    </html>
  );
}
