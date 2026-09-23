import assert from "node:assert/strict";
import test from "node:test";
import { handoffFromItems, mergeHandoff, promptFailureMessage, shouldClearHandoff, shouldFollowTranscript } from "../src/chatHandoff.ts";

test("handoff includes only visible conversational turns", () => {
  assert.equal(handoffFromItems([
    { kind: "user", text: "Make it taller" },
    { kind: "thought", text: "private reasoning" },
    { kind: "tool", text: "secret output" },
    { kind: "plan", text: "internal plan" },
    { kind: "note", text: "app warning" },
    { kind: "agent", text: "I made it taller" },
  ]), "User: Make it taller\nAgent: I made it taller");
  assert.equal(handoffFromItems([{ kind: "thought", text: "only reasoning" }]), null);
});

test("handoff preserves whole recent turns when possible", () => {
  const transcript = handoffFromItems([
    { kind: "user", text: "old request ".repeat(8) },
    { kind: "agent", text: "old answer" },
    { kind: "user", text: "recent request" },
  ], 75);
  assert.equal(transcript, "[Earlier handoff context truncated]\nAgent: old answer\nUser: recent request");
});

test("oversized latest turn is bounded without breaking a surrogate pair", () => {
  const transcript = handoffFromItems([{ kind: "user", text: "a".repeat(80) + "😀" }], 46);
  assert.equal(transcript, "[Earlier handoff context truncated]\nUser: aa😀");
  assert.equal(transcript?.length, 46);
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(transcript ?? ""), false);
});

test("handoff remains pending before IPC but is one-shot after dispatch", () => {
  assert.equal(shouldClearHandoff(false), false);
  assert.equal(shouldClearHandoff(true), true);
  assert.equal(shouldClearHandoff(true, { pre_dispatch: true, message: "attachment missing" }), false);
  assert.equal(shouldClearHandoff(true, { pre_dispatch: false, message: "connection lost" }), true);
  assert.equal(shouldClearHandoff(true, "connection lost"), true);
  assert.equal(promptFailureMessage({ pre_dispatch: true, message: "attachment missing" }), "attachment missing");
  assert.equal(promptFailureMessage("connection lost"), "connection lost");
});

test("switching again preserves pending context and visible turns within the limit", () => {
  assert.equal(mergeHandoff("User: A request\nAgent: A reply", []), "User: A request\nAgent: A reply");
  assert.equal(mergeHandoff("User: A request", [
    { kind: "user", text: "B request" },
    { kind: "note", text: "private app error" },
  ]), "User: A request\nUser: B request");
  const merged = mergeHandoff("Agent: " + "a".repeat(16000), [
    { kind: "user", text: "b".repeat(16000) },
  ]);
  assert.ok(merged?.includes("a".repeat(100)));
  assert.ok(merged?.includes("b".repeat(100)));
  assert.ok((merged?.length ?? 0) <= 16000);
});

test("scroll follows only near the end and can resume after returning there", () => {
  assert.equal(shouldFollowTranscript(1000, 780, 200), true);
  assert.equal(shouldFollowTranscript(1000, 600, 200), false);
  assert.equal(shouldFollowTranscript(1000, 800, 200), true);
});
