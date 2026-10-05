"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { analysisTopic, isFinished, isStageEvent, type StageEvent } from "@/lib/pipeline/stages";
import { useSupabase } from "@/lib/supabase/client";

export type Connection = "connecting" | "live" | "unavailable";

export interface RunProgress extends StageEvent {
  /** When the run last moved, as far as this page knows. */
  movedAt: string;
}

/**
 * A run's progress, kept current by the database. The page subscribes to the
 * analysis's private channel with the signed-in client (the channel policy
 * reads the organization off the same token as the row policies), and the
 * database publishes each time the stage moves. Nothing polls.
 *
 * Once subscribed, the row is read once, because the run may have moved
 * between the server rendering this page and the socket opening. A finished
 * run needs no channel at all.
 */
export function useRunProgress(id: string, initial: RunProgress) {
  const supabase = useSupabase();
  const [progress, setProgress] = useState(initial);
  const [connection, setConnection] = useState<Connection>("connecting");
  const finished = isFinished(progress.status);

  useEffect(() => {
    if (finished) return;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;

    const apply = (event: StageEvent) => {
      if (cancelled) return;
      setProgress({ ...event, movedAt: new Date().toISOString() });
    };

    (async () => {
      // Hand the socket the session token before joining a private channel.
      await supabase.realtime.setAuth();
      if (cancelled) return;
      channel = supabase
        .channel(analysisTopic(id), { config: { private: true } })
        .on("broadcast", { event: "stage" }, ({ payload }) => {
          if (isStageEvent(payload)) apply(payload);
        })
        .subscribe(async (status) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            setConnection("live");
            const { data } = await supabase
              .from("analyses")
              .select("status, stage, stage_message, error, stage_at")
              .eq("id", id)
              .maybeSingle();
            const caughtUp = data && {
              status: data.status,
              stage: data.stage,
              message: data.status === "failed" ? data.error : data.stage_message,
            };
            if (cancelled || !caughtUp || !isStageEvent(caughtUp)) return;
            const movedAt = data.stage_at ?? new Date().toISOString();
            setProgress((current) =>
              caughtUp.status === current.status &&
              caughtUp.stage === current.stage &&
              caughtUp.message === current.message
                ? current
                : { ...caughtUp, movedAt },
            );
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setConnection("unavailable");
          }
        });
    })();

    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [supabase, id, finished]);

  return { progress, connection: finished ? ("live" as const) : connection };
}
