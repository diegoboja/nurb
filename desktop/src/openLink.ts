// `nurb://open?src=<encoded>` is the one deep link the app answers. A URL that
// is not that shape returns null rather than throwing, because the payload
// arrives from the OS and can be anything.
export function srcOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "nurb:") return null;
  if (parsed.hostname !== "open" && parsed.pathname.replace(/^\/+/, "") !== "open") return null;
  return parsed.searchParams.get("src") || null;
}
