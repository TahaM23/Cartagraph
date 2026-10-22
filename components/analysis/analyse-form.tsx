"use client";

import { useActionState, useState } from "react";
import { analyseRepository, type AnalyseState } from "@/app/(app)/analyses/actions";

const INITIAL: AnalyseState = { error: null, url: "" };

/** Small, well-known TypeScript repositories that parse in seconds. */
const EXAMPLES = ["sindresorhus/ky", "pmndrs/zustand", "vercel/swr"];

/** What is typed or pasted, without the host the prefix already shows. */
const withoutHost = (value: string) => value.replace(/^\s*(https?:\/\/)?(www\.)?github\.com\//i, "");

// Paste a URL, land on its analysis: a new one starts running, one the
// organization already has is opened as it is.
export function AnalyseForm() {
  const [state, action, pending] = useActionState(analyseRepository, INITIAL);
  const [value, setValue] = useState(() => withoutHost(state.url));

  return (
    <div className="flex w-full flex-col gap-2.5">
      <form
        action={action}
        className="flex flex-col rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_32px_-12px_rgb(0_0_0/0.12)] focus-within:border-accent/60"
      >
        <label htmlFor="repository-url" className="sr-only">
          Public GitHub repository
        </label>
        <div className="flex items-center px-5 pt-5 pb-3 font-mono text-[16px]">
          <span aria-hidden="true" className="text-faint-foreground select-none">
            github.com/
          </span>
          <input
            id="repository-url"
            name="url"
            type="text"
            required
            autoComplete="off"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(withoutHost(e.target.value))}
            placeholder="owner/repository"
            aria-invalid={state.error ? true : undefined}
            aria-describedby={state.error ? "repository-url-error" : undefined}
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint-foreground"
          />
        </div>

        <div className="flex items-center justify-between gap-3 px-3 pb-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1 pl-2 text-[13px] text-muted-foreground">
            <span className="mr-1">Try</span>
            {EXAMPLES.map((repo) => (
              <button
                key={repo}
                type="button"
                onClick={() => setValue(repo)}
                className="rounded-md border border-border px-2 py-0.5 font-mono text-[12px] text-foreground/80 hover:border-accent/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent"
              >
                {repo}
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={pending}
            title="Analyse"
            className="flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-accent bg-accent/12 px-4 font-medium text-foreground hover:bg-accent/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {pending ? "Starting…" : "Analyse"}
            {!pending && (
              <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4.5 11.5l7-7M5.5 4.5h6v6" />
              </svg>
            )}
          </button>
        </div>
      </form>

      {state.error && (
        <p id="repository-url-error" role="alert" className="px-1 text-center text-muted-foreground">
          {state.error}
        </p>
      )}
    </div>
  );
}
