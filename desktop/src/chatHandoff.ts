type VisibleTurn = { kind: string; text?: string };

export const HANDOFF_LIMIT = 16000;
const TRUNCATED = "[Earlier handoff context truncated]\n";

// Only conversational turns belong in another agent's context. Thoughts,
// plans, tool output, and app notes may contain private or untrusted material.
export function handoffFromItems(items: VisibleTurn[], limit = HANDOFF_LIMIT): string | null {
  const turns = items.flatMap((item) => {
    if (item.kind === "user") return [`User: ${item.text ?? ""}`];
    if (item.kind === "agent") return [`Agent: ${item.text ?? ""}`];
    return [];
  }).filter((turn) => turn.trim() !== "User:" && turn.trim() !== "Agent:");
  if (turns.length === 0) return null;

  const full = turns.join("\n");
  if (full.length <= limit) return full;

  const budget = limit - TRUNCATED.length;
  if (budget <= 0) return null;
  const kept: string[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    const cost = turn.length + (kept.length ? 1 : 0);
    if (used + cost > budget) break;
    kept.unshift(turn);
    used += cost;
  }
  if (kept.length > 0) return TRUNCATED + kept.join("\n");

  // A single oversized latest turn still matters. Slice by code point rather
  // than UTF-16 code unit so an emoji cannot be split into a lone surrogate.
  const latest = turns[turns.length - 1];
  const label = latest.startsWith("User: ") ? "User: " : "Agent: ";
  const available = budget - label.length;
  if (available <= 0) return null;
  const characters = Array.from(latest.slice(label.length));
  let suffix = "";
  for (let index = characters.length - 1; index >= 0; index--) {
    if (suffix.length + characters[index].length > available) break;
    suffix = characters[index] + suffix;
  }
  return TRUNCATED + label + suffix;
}

// A failed session start or typed pre-dispatch error sent nothing. All other
// IPC failures are uncertain and must not replay the handoff automatically.
type PromptFailure = { pre_dispatch: boolean; message: string };

function isPromptFailure(error: unknown): error is PromptFailure {
  return typeof error === "object" && error !== null &&
    "pre_dispatch" in error && typeof error.pre_dispatch === "boolean" &&
    "message" in error && typeof error.message === "string";
}

export function promptFailureMessage(error: unknown): string {
  return isPromptFailure(error) ? error.message : String(error);
}

export function shouldClearHandoff(dispatchAttempted: boolean, error?: unknown): boolean {
  return dispatchAttempted && !(isPromptFailure(error) && error.pre_dispatch);
}

// Switching again before a first successful dispatch must carry both the
// previous agent's context and any visible turns from this agent. Reserve
// space for each side rather than letting a long new turn erase the earlier one.
export function mergeHandoff(previous: string | null, items: VisibleTurn[]): string | null {
  if (!previous) return handoffFromItems(items);
  const current = handoffFromItems(items);
  if (!current) return previous;
  const separator = "\n";
  if (previous.length + separator.length + current.length <= HANDOFF_LIMIT) {
    return previous + separator + current;
  }
  const half = Math.floor((HANDOFF_LIMIT - separator.length) / 2);
  const recent = (value: string, limit: number) => {
    if (value.length <= limit) return value;
    const suffix = Array.from(value).reverse();
    let result = "";
    for (const character of suffix) {
      if (result.length + character.length + TRUNCATED.length > limit) break;
      result = character + result;
    }
    return TRUNCATED + result;
  };
  const earlierBudget = Math.min(previous.length, half);
  const currentBudget = HANDOFF_LIMIT - separator.length - earlierBudget;
  return recent(previous, earlierBudget) + separator + recent(current, currentBudget);
}

export function shouldFollowTranscript(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < 24;
}
