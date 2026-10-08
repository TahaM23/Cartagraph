import { defineIdentity } from "managed-deepagents";

// Who may call this deployment: only Cartograph's server. It signs the person
// in with Clerk, checks they can see the analysis, then calls here with
// MDA_INGRESS_SECRET and their user id, so each person's conversations are
// their own. Browsers never call the agent directly.
export const identity = defineIdentity({
  auth: "backend",
});
