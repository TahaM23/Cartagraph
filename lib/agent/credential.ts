// The credential a conversation with the agent carries: one analysis, its
// organization, and an expiry, HMAC-signed with AGENT_CREDENTIAL_SECRET.
//
// Only the app signs these, and only after the asker's own session has shown
// the analysis is theirs. Nothing in the app verifies them: the database does
// (private.agent_credential_analysis), against the same secret in Vault, so
// the endpoint that reads the graph holds no key of its own.

import { createHmac } from "node:crypto";

/** Long enough for a conversation, short enough that a leaked one is soon worthless. */
export const CREDENTIAL_TTL_SECONDS = 30 * 60;

/** Agent access is optional: without the secret, the rest of the app runs and Ask says it is unavailable. */
export class AgentUnavailable extends Error {}

export function signCredential(analysisId: string, orgId: string, now = Date.now()): string {
  const secret = process.env.AGENT_CREDENTIAL_SECRET?.trim();
  if (!secret) throw new AgentUnavailable("AGENT_CREDENTIAL_SECRET is not set, so the agent cannot be given access.");
  const payload = Buffer.from(
    JSON.stringify({ a: analysisId, o: orgId, exp: Math.floor(now / 1000) + CREDENTIAL_TTL_SECONDS }),
  ).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}
