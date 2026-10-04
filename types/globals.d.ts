export {};

declare global {
  // Custom claims added to the Clerk session token (instance config:
  // session.claims). The active org's id/role ride in the default `o` claim.
  interface CustomJwtSessionClaims {
    role?: "authenticated";
    org_name?: string;
  }
}
