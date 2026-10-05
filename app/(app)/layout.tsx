import { OrganizationSwitcher, UserButton } from "@clerk/nextjs";
import { cookies } from "next/headers";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { parseTheme, THEME_COOKIE } from "@/lib/theme";

// The application shell. Every signed-in route renders inside it; proxy.ts
// guarantees there is a session before this runs.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 items-center justify-between gap-4 border-b border-border px-4 sm:px-5">
        <div className="flex items-center gap-3">
          <Link href="/" className="font-mono font-semibold">
            cartograph
          </Link>
          <span className="text-faint-foreground">/</span>
          <OrganizationSwitcher
            hidePersonal
            organizationProfileMode="navigation"
            organizationProfileUrl="/organization"
            afterSelectOrganizationUrl="/"
            afterCreateOrganizationUrl="/"
            afterLeaveOrganizationUrl="/"
          />
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle initial={theme} />
          <UserButton />
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
