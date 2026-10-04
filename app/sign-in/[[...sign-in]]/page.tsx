import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4 py-12">
      <span className="text-lg font-semibold tracking-tight">Cartograph</span>
      <SignIn />
    </div>
  );
}
