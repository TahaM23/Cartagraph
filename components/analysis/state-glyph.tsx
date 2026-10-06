// States are told apart by shape, not colour: filled when done, half while
// parsing, hollow while waiting, a crossed circle when it failed, and a
// broken ring when it stopped moving without finishing.
export function StateGlyph({ state }: { state: string }) {
  return (
    <svg viewBox="0 0 12 12" className="size-3 shrink-0" aria-hidden="true">
      {state === "complete" && (
        <circle cx="6" cy="6" r="5.5" className="fill-muted-foreground" />
      )}
      {state === "parsing" && (
        <>
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 1a5 5 0 0 0 0 10z" fill="currentColor" />
        </>
      )}
      {state === "queued" && (
        <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      )}
      {state === "stale" && (
        <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2.6 1.6" />
      )}
      {state === "failed" && (
        <>
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          <path d="M4 4l4 4M8 4l-4 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
