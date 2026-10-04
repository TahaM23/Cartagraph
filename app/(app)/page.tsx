import { auth } from "@clerk/nextjs/server";
import Link from "next/link";

// The active organization's workspace. Everything here comes from the
// verified session token; nothing asks Clerk at request time.
export default async function WorkspacePage() {
  const { orgId, orgRole, sessionClaims } = await auth();

  if (!orgId) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-muted-foreground">
          No active organization. Pick one from the switcher above.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <p className="text-sm text-muted-foreground">Workspace</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        {sessionClaims?.org_name ?? orgId}
      </h1>
      <dl className="mt-8 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Organization</dt>
        <dd className="font-mono">{orgId}</dd>
        <dt className="text-muted-foreground">Your role</dt>
        <dd className="font-mono">{orgRole}</dd>
      </dl>
      <Link
        href="/organization/organization-members"
        className="mt-8 inline-flex h-9 items-center rounded-full border border-border px-4 text-sm font-medium transition-colors hover:bg-muted"
      >
        Members &amp; invitations
      </Link>
    </div>
  );
}
