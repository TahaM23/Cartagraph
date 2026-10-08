<div align="center">

# Cartograph

**A dependency map for codebases nobody has read.**

Paste a public GitHub repository and get a map of it, built by parsing the code, never guessed.<br>
Click any file to see what it imports, what imports it, and what breaks if it changes.

<br>

![Next.js](https://img.shields.io/badge/Next.js_16-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![React](https://img.shields.io/badge/React_19-149ECA?style=for-the-badge&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS_4-06B6D4?style=for-the-badge&logo=tailwindcss&logoColor=white)
<br>
![Supabase](https://img.shields.io/badge/Supabase-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL_RLS-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Clerk](https://img.shields.io/badge/Clerk-6C47FF?style=for-the-badge&logo=clerk&logoColor=white)
![Zod](https://img.shields.io/badge/Zod_4-3E67B1?style=for-the-badge&logo=zod&logoColor=white)
<br>
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)
![LangChain](https://img.shields.io/badge/Deep_Agents-1C3C3C?style=for-the-badge&logo=langchain&logoColor=white)
![LangSmith](https://img.shields.io/badge/LangSmith-F4A261?style=for-the-badge&logo=langchain&logoColor=black)
![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white)

<br>

![The map of a repository: folders as boxes, imports as lines. lib/parser/types.ts is selected; the 22 files that import it are lit in green, and the pane lists its blast radius of 31 files within two levels.](docs/screenshots/map.jpg)

</div>

## Why

More and more code is written by AI and never read by a person. Then someone has to change it, and the first questions are structural: what is this file, what depends on it, what breaks if I touch it?

Most AI code tools let a model *describe* the structure. Cartograph doesn't. **Every box and line comes from parsing the code**, because a map that's 90% right is worse than none: you can't tell which 10% is wrong. AI only explains and answers questions, on top of the real graph.

## Features

- **Map:** folders as boxes, imports as lines. Open a folder to see its files.
- **Blast radius:** what breaks if a file changes, two levels out, instantly.
- **Framework aware:** knows Next.js, NestJS, Express, React, Vite and Docusaurus pages, routes and controllers.
- **Coverage:** says exactly what was parsed, skipped, or couldn't be resolved.
- **Explain:** a short AI-written summary of any file, from its real code.
- **Ask:** ask a question in plain English and watch each lookup happen live.
- **Teams:** every analysis belongs to an organization, and the database enforces it.

<div align="center">

![Ask mode: asked "What breaks if I change this file?" with lib/parser/types.ts selected, the agent walks its dependents, finds 31, the same number as the map's blast radius, and lists them as links into the map.](docs/screenshots/ask.jpg)

</div>

## Highlights

- **Real parsing.** Uses the TypeScript compiler to read every import, including path aliases, barrel files and `require()`.
- **Security in the database.** Row-level security is switched on for every table automatically, so a forgotten rule shows nothing instead of everything.
- **An agent that can't be tricked.** It never knows which analysis it's reading. A signed, 30-minute pass does, and the database checks it. A "read someone else's data" prompt hidden in a repo has nothing to work with.
- **One source of truth.** The agent's lookups run the same code that draws the map, so they always agree (31 and 31 above).
- **AI you can measure.** Every model call is traced and cached, answers are checked for made-up file paths, and the agent has its own eval.

## How it works

Shaded boxes call an AI model. Everything else is plain code.

![The browser talks to the Next.js server, which reads Supabase as the signed-in user, writes with the secret key, and calls GitHub, OpenAI, LangSmith and the agent service.](docs/diagrams/overview.svg)

**Analysing a repository:** download, pick the source files, parse, label, save. Progress streams to the browser live.

![The run: fetch, select, parse, label and store. Each stage writes its progress to the analysis row, which Realtime pushes to the progress page; the map opens when the run completes.](docs/diagrams/pipeline.svg)

**Explaining a file:** cached by content, so the same file never costs twice, and checked for invented paths.

![Inside one traced run: read the neighbours, build a cache key, look it up. A hit answers with no model call; a miss fetches the file at the analysed commit, calls the model and checks the answer for invented paths. A freshness check runs alongside.](docs/diagrams/explain.svg)

**Asking a question:** the agent gets a pass for one analysis, and the database checks it on every lookup.

![The Ask pane sends the question to /api/ask, which mints a pass for one analysis; the agent calls lookups with that pass; the database checks it and returns that analysis's graph; each step streams back to the pane.](docs/diagrams/ask.svg)

## Evaluation

`pnpm eval:agent` asks the agent 21 real questions, including ones it should refuse and a prompt-injection attempt.

| Check | Result |
|---|---|
| Looked something up before every answer | 100% |
| Only named files it actually found | 100% |
| Never leaked its tools, ids or credentials | 100% |
| Answered plainly instead of hedging *(AI-judged)* | 100% |
| Declined bad questions cleanly *(AI-judged)* | 83% |

The eval caught a real bug: asked to list files, the agent made some up. The fix was a lookup that lists real files, not a longer prompt.

## Quick start

You need Node 24+, pnpm, the Supabase CLI, and free [Clerk](https://clerk.com) and [Supabase](https://supabase.com) accounts.

```bash
git clone https://github.com/TahaM23/Cartagraph.git
cd Cartagraph
pnpm install
supabase link --project-ref <your-project-ref> && supabase db push
pnpm dev
```

Before `pnpm dev`, connect Clerk to Supabase and put your keys in `.env.local`. Then open http://localhost:3000.

**Full step-by-step setup**, including the optional Explain and Ask features and troubleshooting, is in **[docs/setup.md](docs/setup.md)**.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app |
| `pnpm parse <folder>` | Parse a local folder, no setup needed |
| `pnpm analyse <github url> --dry-run` | Parse a GitHub repo, no database |
| `pnpm eval:agent` | Score the Ask agent |
| `pnpm eval:paths` · `eval:roles` · `eval:prompts` | Score explanations and labels |
