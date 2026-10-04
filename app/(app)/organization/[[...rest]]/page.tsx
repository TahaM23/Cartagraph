import { OrganizationProfile } from "@clerk/nextjs";

// Clerk's organization settings: general, members, and invitations.
export default function OrganizationPage() {
  return (
    <div className="flex justify-center px-4 py-10">
      <OrganizationProfile routing="path" path="/organization" />
    </div>
  );
}
