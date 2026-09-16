// Mono-label formatters. Every figure carries a unit (DESIGN.md §8).

export function rev(n: number | null | undefined): string {
  return `REV ${String(Math.max(0, n ?? 0)).padStart(2, "0")}`
}

// A stack label for a card strip: "fable-5 low", "grok-4.6 low". The
// vendor prefix says nothing the model name does not.
export function stackLabel(model: string | null | undefined, effort?: string | null): string | null {
  if (!model) return null
  const name = model.replace(/^claude-/, "")
  return effort ? `${name} ${effort}` : name
}

// A build's wall-clock, as m:ss.
export function clock(seconds: number | null | undefined): string | null {
  if (seconds == null) return null
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

// A live counter's reading: one decimal under a minute, m:ss at or above one.
// The cut is 59.95 rather than 60 so the tenths never show "60.0s" on their way
// over. Never blank: a run that just started reads "0.0s".
export function elapsedLabel(seconds: number): string {
  const s = Math.max(0, seconds)
  if (s < 59.95) return `${s.toFixed(1)}s`
  return clock(s) as string
}
