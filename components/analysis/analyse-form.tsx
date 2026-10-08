"use client";

import { useActionState } from "react";
import { analyseRepository, type AnalyseState } from "@/app/(app)/analyses/actions";

const INITIAL: AnalyseState = { error: null, url: "" };

// Paste a URL, land on its analysis: a new one starts running, one the
// organization already has is opened as it is.
export function AnalyseForm() {
  const [state, action, pending] = useActionState(analyseRepository, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <label htmlFor="repository-url" className="sr-only">
          Public GitHub repository URL
        </label>
        <input
          id="repository-url"
          name="url"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          defaultValue={state.url}
          placeholder="github.com/owner/repository"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "repository-url-error" : undefined}
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 font-mono text-[13px] outline-none placeholder:text-faint-foreground focus-visible:border-accent"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-8 shrink-0 rounded-md bg-accent px-3 font-medium text-white transition-opacity disabled:opacity-60"
        >
          {pending ? "Starting…" : "Analyse"}
        </button>
      </div>
      {state.error && (
        <p id="repository-url-error" role="alert" className="text-muted-foreground">
          {state.error}
        </p>
      )}
    </form>
  );
}
