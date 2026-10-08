# Setting up Cartograph

Step by step, from a fresh clone. The map needs Clerk and Supabase; Explain and Ask are optional and add OpenAI, LangSmith and the agent service.

## What you need

- **Node.js 24 or newer.** The scripts run TypeScript directly with Node.
- **pnpm**: `npm install -g pnpm`
- **Supabase CLI**: `brew install supabase/tap/supabase` ([other installs](https://supabase.com/docs/guides/local-development/cli/getting-started))
- Free accounts on **[Clerk](https://clerk.com)** and **[Supabase](https://supabase.com)**.
- Optional: an **[OpenAI](https://platform.openai.com)** API key (Explain, labelling, Ask) and a **[LangSmith](https://smith.langchain.com)** API key (tracing, evals, Ask).

The map works without OpenAI or LangSmith. Without them, Explain and Ask say they are unavailable and everything else runs.

---

## Run the map

### 1. Get the code

```bash
git clone https://github.com/TahaM23/Cartagraph.git
cd Cartagraph
pnpm install
```

### 2. Set up Clerk

1. Create an application in the [Clerk dashboard](https://dashboard.clerk.com). Turn on the sign-in methods you want (email, GitHub, Google).
2. Turn on **Organizations** (Configure → Organizations). Every analysis belongs to an organization.
3. Open **API keys** and keep the publishable key (`pk_test_…`) and secret key (`sk_test_…`) for step 4.

### 3. Set up Supabase

1. Create a project in the [Supabase dashboard](https://supabase.com/dashboard).
2. **Connect Clerk to it.** The database reads who you are from Clerk's token:
   - In Clerk, open the **Supabase** integration ([setup page](https://dashboard.clerk.com/setup/supabase)) and activate it. Copy the Clerk domain it shows.
   - In Supabase, go to **Authentication → Sign In / Providers → Third-Party Auth**, add **Clerk**, and paste that domain.
3. **Create the tables.** From the project folder:
   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>   # the id in your Supabase project URL
   supabase db push
   ```
   This creates every table with row-level security on, the progress channel, and the database functions.
4. Keep, from **Project Settings → API keys**: the project URL, the **publishable** key (`sb_publishable_…`) and the **secret** key (`sb_secret_…`).

Do not run `supabase/seed.sql`: its rows belong to the original author's Clerk organizations.

### 4. Create `.env.local`

In the project folder, create a file named `.env.local`:

```bash
# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

`.env.local` is git-ignored. Only the `NEXT_PUBLIC_` values ever reach a browser, and those are meant to be public.

### 5. Start it

```bash
pnpm dev
```

Open **http://localhost:3000**, sign up, and create or pick an organization. Paste a public repository URL, for example `https://github.com/sindresorhus/ky`, and watch it parse. The map opens when the run completes.

If `pnpm dev` stops with "Missing required environment variables", it names the ones step 4 is missing.

---

## Optional: Explain and labelling

Add to `.env.local`, then restart `pnpm dev`:

```bash
OPENAI_API_KEY=sk-...

# Optional: record every model call in LangSmith
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_PROJECT=cartograph
LANGSMITH_API_KEY=lsv2_...
```

Then select a file or folder on the map, open the **Explanation** tab and press **Explain**. New analyses also get role labels for files no framework convention identified.

Every explanation costs an OpenAI call the first time and is cached after that. Set a spend limit in your OpenAI account before sharing a deployment.

---

## Optional: Ask

Ask is answered by a separate service in `cartograph-agent/`, built on [Managed Deep Agents](https://docs.langchain.com/langsmith/managed-deep-agents-overview) (public beta, LangSmith US region). It needs everything in the Explain section, plus the steps below.

### 1. Make two secrets

Run this twice and keep both values:

```bash
openssl rand -base64 36 | tr -d '\n=+/'
```

- the **credential secret**: signs the short-lived pass that lets the agent read one analysis;
- the **ingress secret**: proves a call to the agent came from the app.

### 2. Give the credential secret to Supabase

In the Supabase dashboard, open **SQL Editor** and run this once, with your credential secret in place of `PASTE_VALUE_HERE`:

```sql
select vault.create_secret('PASTE_VALUE_HERE', 'agent_credential_secret');
```

Delete the query afterwards: it contains the secret.

### 3. Add to `.env.local`

```bash
AGENT_CREDENTIAL_SECRET=<credential secret>
AGENT_INGRESS_SECRET=<ingress secret>
AGENT_URL=http://localhost:2024
```

### 4. Set up the agent

```bash
cd cartograph-agent
npm install
```

Create `cartograph-agent/.env`:

```bash
LANGSMITH_API_KEY=lsv2_...
OPENAI_API_KEY=sk-...
CARTOGRAPH_API_URL=http://localhost:3000/api/agent
MDA_INGRESS_SECRET=<ingress secret, the same value as AGENT_INGRESS_SECRET>
```

### 5. Run both

In one terminal, from the project folder:

```bash
pnpm dev
```

In a second terminal:

```bash
cd cartograph-agent
npm run dev
```

The agent starts on port 2024 and opens LangSmith Studio, which you can close. In the app, open a map and click **Ask** at the top of the right-hand pane.

To check the agent's lookups without the model: `npm run check:tools` in `cartograph-agent/`.

## Troubleshooting

- **The dashboard shows no analyses, or saving one fails.** Clerk is not connected to Supabase (step 3.2), or no organization is selected. The database reads your organization from Clerk's token.
- **Explain says "OPENAI_API_KEY is not set".** Add it to `.env.local` and restart `pnpm dev`.
- **Ask says it is unavailable.** The agent is not running (`npm run dev` in `cartograph-agent/`), or `AGENT_URL` / `AGENT_INGRESS_SECRET` are missing.
- **Ask's lookups fail with "access … refused or has expired".** The Vault secret does not match `AGENT_CREDENTIAL_SECRET`, or the migrations were not pushed.
- **The agent fails with "401 Incorrect API key".** Check `OPENAI_API_KEY` in `cartograph-agent/.env` for a stray character.
- **A repository will not analyse.** Only public repositories are supported, with at most 5,000 TypeScript or JavaScript source files.
