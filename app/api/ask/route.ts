import { auth } from "@clerk/nextjs/server";
import { Client } from "@langchain/langgraph-sdk";
import { z } from "zod";
import { AgentUnavailable, signCredential } from "@/lib/agent/credential";
import type { AskEvent } from "@/lib/agent/events";
import { eventsFrom } from "@/lib/agent/relay";
import { createServerSupabase } from "@/lib/supabase/server";

// Asking the agent about an analysis. The asker's own session shows the
// analysis is theirs; then a credential naming only that analysis is minted
// and handed to the run as context, never as text, and the run's steps are
// relayed to the pane as they happen.
//
// The agent is a separate service. When it is down or not configured, this
// says so and nothing else in the app notices.

// Three or four lookups and an answer take tens of seconds.
export const maxDuration = 120;

const ASSISTANT = "cartograph-agent";

const Ask = z.object({
  analysisId: z.uuid(),
  question: z.string().trim().min(1).max(2000),
  threadId: z.uuid().optional(),
  selected: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("file"), path: z.string().min(1).max(1024) }),
      z.object({ kind: z.literal("folder"), dir: z.string().max(1024) }),
    ])
    .nullable()
    .optional(),
});

const UNAVAILABLE = "Ask is unavailable right now. The map and explanations still work.";

const refuse = (status: number, error: string) => Response.json({ error }, { status });

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return refuse(401, "Sign in to ask about an analysis.");

  const parsed = Ask.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return refuse(400, "That is not a question this pane can send.");
  const { analysisId, question, threadId, selected } = parsed.data;

  // Visible through the user's client means it belongs to their organization.
  const db = await createServerSupabase();
  const { data: analysis, error } = await db
    .from("analyses")
    .select("id, org_id, status")
    .eq("id", analysisId)
    .maybeSingle();
  if (error) return refuse(500, `Reading the analysis failed: ${error.message}`);
  if (!analysis) return refuse(404, "No such analysis in this organization.");
  if (analysis.status !== "complete") return refuse(409, "This analysis is being re-run; ask once it completes.");

  const apiUrl = process.env.AGENT_URL?.trim();
  const ingress = process.env.AGENT_INGRESS_SECRET?.trim();
  let credential: string;
  try {
    if (!apiUrl || !ingress) throw new AgentUnavailable("AGENT_URL and AGENT_INGRESS_SECRET must both be set.");
    credential = signCredential(analysis.id, analysis.org_id);
  } catch (e) {
    if (e instanceof AgentUnavailable) {
      console.warn(`Ask is off: ${e.message}`);
      return refuse(503, UNAVAILABLE);
    }
    throw e;
  }

  // Only the ingress secret and who is asking; never a LangSmith key from the environment.
  const agent = new Client({
    apiUrl,
    apiKey: null,
    defaultHeaders: { "x-mda-ingress-secret": ingress!, "x-mda-user-id": userId },
  });

  const where =
    selected?.kind === "file" ? `Selected in the map: the file \`${selected.path}\`.\n\n`
    : selected?.kind === "folder" ? `Selected in the map: the folder \`${selected.dir || "(root)"}\`.\n\n`
    : "";

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AskEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        // A conversation is about one analysis; a follow-up must name the same one.
        let thread: string;
        if (threadId) {
          const existing = await agent.threads.get(threadId);
          if ((existing.metadata as { analysis_id?: unknown } | null)?.analysis_id !== analysis.id) {
            send({ type: "error", message: "That conversation is about another analysis. Start a new one." });
            return;
          }
          thread = threadId;
        } else {
          thread = (await agent.threads.create({ metadata: { analysis_id: analysis.id } })).thread_id;
        }
        send({ type: "thread", id: thread });

        for await (const part of agent.runs.stream(thread, ASSISTANT, {
          input: { messages: [{ role: "user", content: `${where}${question}` }] },
          context: { credential },
          streamMode: ["updates"],
          signal: request.signal,
        })) {
          if (part.event === "error") {
            console.error("agent run failed:", part.data);
            send({ type: "error", message: "The agent could not finish this answer. Try asking again." });
          } else if (part.event === "updates") {
            for (const event of eventsFrom(part.data)) send(event);
          }
        }
      } catch (e) {
        if (!request.signal.aborted) {
          console.error("asking the agent failed:", e);
          send({ type: "error", message: UNAVAILABLE });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
