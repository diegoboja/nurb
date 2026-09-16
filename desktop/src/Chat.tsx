import {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AssistantMarkdown,
  BuildCard,
  Icon,
  MeasurementCard,
  SpecCard,
  ToolStepCard,
  type Message,
} from "@nurb/ui";
import { absolute, addMessage } from "@nurb/workbench/api";
import {
  applyChatEvent,
  claudeNote,
  describe,
  type ChatEvent,
  type Item,
  type PermissionOption,
  pruneLanded,
  withNote,
} from "./chatItems";
import { playChime, shouldPlayCompletionChime } from "./chime";
import { AttachmentDraft, restoreDraftText } from "./chatDraft";

// The whole-project conversation rides the per-part plumbing under a name no part
// file can have. Twins live in App.tsx's mount and acp.rs's context line.
export const PROJECT_CHAT = "//project";

type Permission = { id: number; title: string; options: PermissionOption[] };

// Mirrors ConfigRow in src-tauri/src/prefs.rs: the model and effort selects,
// as the agent itself describes them.
type ConfigChoice = { value: string; name: string; description?: string };
type ConfigRow = {
  id: string;
  // "model" or "thought_level": the key the app addresses a row by, since the
  // agents name the options themselves differently.
  category: string;
  name: string;
  value: string;
  options: ConfigChoice[];
};

// Mirrors AgentKind::label in src-tauri/src/agents.rs.
export const AGENT_LABEL: Record<string, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  cursor: "Cursor",
  grok: "Grok",
  "claude-acp": "Claude (adapter)",
};

const basename = (path: string) => path.split("/").pop() ?? path;

// The button's own label: the selected names, not the model ids, since those
// are the agent's wire values and mean nothing to someone printing a bracket.
function summarize(config: ConfigRow[]): string {
  return config
    .map((row) => row.options.find((o) => o.value === row.value)?.name ?? row.value)
    .join(" · ");
}

const CLAUDE_SIGN_IN =
  "Sign in to Claude Code first: open a terminal, run claude, and follow the prompts. Then come back here.";

/** One row of the project's own transcript. */
function Stored({ message }: { message: Message }) {
  const payload = message.payload;
  return (
    <div className="flex flex-col gap-3">
      {message.content ? (
        message.role === "user" ? (
          <p className="text-chat ml-8 rounded-content bg-raised px-3 py-2 text-ink">
            {message.content}
          </p>
        ) : (
          <div className="text-chat text-ink-soft">
            <AssistantMarkdown content={message.content} />
          </div>
        )
      ) : null}
      {payload?.type === "build" && (
        // The serve's render path is relative to the serve, not to this page.
        <BuildCard
          build={{
            ...payload.build,
            render_url: payload.build.render_url ? absolute(payload.build.render_url) : undefined,
          }}
        />
      )}
      {payload?.type === "spec" && (
        <SpecCard spec={payload.spec} model={payload.model} effort={payload.effort} />
      )}
      {payload?.type === "measurement" && <MeasurementCard measurement={payload.measurement} />}
      {payload?.type === "step" && <ToolStepCard step={payload.step} />}
    </div>
  );
}

function Chat({
  path,
  part,
  messages,
  agent,
  agents,
  resume,
  hidden,
  seed,
  onSeed,
  onSession,
  onFresh,
  onAgent,
  onBusy,
  onSignIn,
}: {
  path: string;
  // The project's own transcript, which outlives any one conversation. Hidden
  // columns are handed an empty list, since only the selected project loads one.
  messages: Message[];
  // The column's identity: this is the part's conversation, whatever the
  // viewer shows by the time a reply lands.
  part: string;
  // Fixed for the life of the conversation: a resumed session keeps the agent
  // that ran it, a fresh one takes the default from the agents pane.
  agent: string;
  // Everything the app can host, for the header's switcher.
  agents: { id: string; label: string; loggedIn: boolean | null }[];
  resume: string | null;
  hidden: boolean;
  // Text waiting for the composer, from a viewer nudge. Prefilled when the column
  // is visible, never sent; onSeed reports it landed so the owner clears it.
  seed?: string | null;
  onSeed?: () => void;
  onSession: (id: string) => void;
  onFresh: () => void;
  // Switching agents cannot move a conversation across two different session
  // stores, so it starts a fresh one on the agent picked. `unstarted` is true
  // when nothing has been said yet, which makes the pick the new default.
  onAgent: (id: string, unstarted: boolean) => void;
  onBusy: (busy: boolean) => void;
  onSignIn: (agent: string) => Promise<boolean>;
}) {
  const label = AGENT_LABEL[agent] ?? agent;
  // Known signed out, not merely unknown: an unknown status stays quiet.
  const signedOut = agents.find((option) => option.id === agent)?.loggedIn === false;
  // The sentinel never reaches copy: everywhere the column says its name, the
  // project conversation speaks of the project.
  const isProject = part === PROJECT_CHAT;
  // Claude runs through the app's own driver, which stores the conversation in
  // the project rather than replaying one of its own.
  const isClaude = agent === "claude";
  // The folder's last segment is the project's id in the store.
  const projectId = path.split("/").filter(Boolean).pop() ?? "";
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  // A resumed transcript starts loading after the first paint, so treat it as
  // starting immediately rather than briefly exposing a live composer.
  const [starting, setStarting] = useState(Boolean(resume));
  // A refused prompt needs explicit resend guidance; a proactive or resume sign-in does not.
  const [authNeeded, setAuthNeeded] = useState<"none" | "sign-in" | "resume" | "resend">("none");
  const [signingIn, setSigningIn] = useState(false);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  // Absolute paths; the Rust side reads them at send time.
  const [attachments, setAttachments] = useState<string[]>([]);
  const attachmentDraftRef = useRef<AttachmentDraft | null>(null);
  if (!attachmentDraftRef.current) {
    attachmentDraftRef.current = new AttachmentDraft(setAttachments);
  }
  const attachmentDraft = attachmentDraftRef.current;
  const [dropping, setDropping] = useState(false);
  // The project's transcript in the order it was written, then whatever this
  // turn has produced that has not reached the store yet.
  const ordered = [...messages].sort(
    (a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0),
  );
  const said = messages.length > 0 || items.length > 0;
  // The newest stored row, read at event time so a step remembers where the
  // transcript stood when it was called.
  const seqRef = useRef(0);
  seqRef.current = messages.reduce((top, m) => Math.max(top, m.sequence_number ?? 0), 0);
  useEffect(() => {
    setItems((list) => pruneLanded(list, messages));
  }, [messages]);
  // The model and effort this conversation runs on. Empty before the agent has
  // ever reported its lists, which is only ever the first chat on this Mac.
  const [config, setConfig] = useState<ConfigRow[]>([]);
  const [picking, setPicking] = useState(false);
  const [switching, setSwitching] = useState(false);
  const sessionRef = useRef<string | null>(null);
  // A resume id is single-use after the adapter accepts it. Authentication
  // failures retain it; a dead resumed session must not replay it again.
  const resumeRef = useRef<string | null>(resume);
  const restoringRef = useRef(Boolean(resume));
  // Refs, not state: these guard against races within a tick (double-Enter)
  // and after unmount, where state reads are stale or gone.
  const closedRef = useRef(false);
  const sendingRef = useRef(false);
  const nextLocalIdRef = useRef(1);
  // In-flight start, shared across StrictMode's double mount so a resume on
  // mount cannot spawn two adapters.
  const startRef = useRef<Promise<string> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Latest callbacks behind stable refs so ensureSession never goes stale.
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;
  const onBusyRef = useRef(onBusy);
  onBusyRef.current = onBusy;

  useEffect(() => {
    // A removed column cannot leave a stale rail dot behind. Turn transitions
    // report synchronously in send(), before adapter startup can race UI state.
    return () => onBusyRef.current(false);
  }, []);

  useEffect(() => {
    // Kill the adapter when this project's chat column goes away. StrictMode
    // remounts reuse the refs, so closed is reset on mount.
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) invoke("close_chat", { sessionId: session }).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const pane = scrollRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [messages, items, permissions, busy]);

  useEffect(() => {
    // Dev-only test hook: the Rust side forwards loopback-socket text here so
    // UI automation can fill the composer without stealing keyboard focus.
    if (!import.meta.env.DEV) return;
    const unlisten = listen<string>("test-type", (event) => {
      if (inputRef.current) inputRef.current.value = event.payload;
    });
    return () => {
      unlisten.then((stop) => stop()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    // Same hook, submit half: every mounted column hears the event, so only
    // the visible one sends.
    if (!import.meta.env.DEV || hidden) return;
    const unlisten = listen("test-send", () => {
      inputRef.current?.form?.requestSubmit();
    });
    return () => {
      unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [hidden]);

  useEffect(() => {
    // A seed lands once the column is visible. Below any half-typed draft rather
    // than over it; the user's own words outrank a nudge's.
    if (hidden || !seed) return;
    const box = inputRef.current;
    if (box) {
      // Idempotent: StrictMode double-runs mount effects, and the clearing of
      // the seed above only lands after this commit.
      if (box.value !== seed && !box.value.endsWith(`\n${seed}`)) {
        box.value = box.value.trim() ? `${box.value}\n${seed}` : seed;
      }
      box.focus();
    }
    onSeed?.();
  }, [hidden, seed, onSeed]);

  useEffect(() => {
    // OS file drags arrive as Tauri window events with paths, not HTML5 drops.
    // Every part's chat is mounted at once, so only the visible column listens
    // or one drop would attach to every conversation.
    if (hidden) return;
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "enter") setDropping(true);
      if (event.payload.type === "leave") setDropping(false);
      if (event.payload.type === "drop") {
        setDropping(false);
        const paths = event.payload.paths;
        attachmentDraft.add(paths);
      }
    });
    return () => {
      unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [hidden, attachmentDraft]);

  const applyEvent = useCallback(
    (event: ChatEvent) => {
      switch (event.type) {
        case "session_info":
          // Titles have no home since the visible session list went away.
          return;
        case "permission_request":
          setPermissions((list) => [
            ...list,
            { id: event.id, title: event.title, options: event.options },
          ]);
          return;
        case "permission_resolved":
          setPermissions((list) => list.filter((p) => p.id !== event.id));
          return;
        case "prose":
          // The finished block belongs to the project, not to this session, so
          // it is written to the transcript and the streaming copy is dropped.
          if (isClaude) {
            // Drop the streaming copy only once the row exists, or the text
            // blinks out for the refetch's round trip.
            addMessage(projectId, "assistant", event.text)
              .then(() => setItems((list) => applyChatEvent(list, event, Date.now(), seqRef.current)))
              .catch((e) =>
                setItems((list) => [...list, { kind: "note", text: String(e) }]),
              );
            return;
          }
          break;
        case "session_error": {
          // The dead session is gone from the Rust map too; forgetting it here
          // is what lets the next send start the fresh chat the note promises.
          // The driver's session lives on disk, so the next start resumes it.
          if (isClaude && sessionRef.current) resumeRef.current = sessionRef.current;
          sessionRef.current = null;
          const trouble = isClaude ? claudeNote(event.message) : null;
          if (trouble) {
            setItems((list) => withNote(list, trouble));
            return;
          }
          break;
        }
      }
      setItems((list) => applyChatEvent(list, event, Date.now(), seqRef.current));
    },
    [isClaude, projectId],
  );

  const refreshConfig = useCallback(() => {
    invoke<ConfigRow[]>("chat_config", { agent, sessionId: sessionRef.current })
      .then(setConfig)
      .catch(() => {});
  }, [agent]);

  useEffect(refreshConfig, [refreshConfig]);

  useEffect(() => {
    // The lists arrive from the project's session-list probe, which can land
    // after this column mounted. Without this the first chat opened on a fresh
    // install has no picker until something else remounts it.
    const unlisten = listen("agent-config", () => refreshConfig());
    return () => {
      unlisten.then((stop) => stop()).catch(() => {});
    };
  }, [refreshConfig]);

  const pick = useCallback(
    async (category: string, value: string) => {
      // Optimistic: the round trip goes through the adapter, and a select that
      // lags behind the click reads as a dropped one.
      setConfig((rows) =>
        rows.map((row) => (row.category === category ? { ...row, value } : row)),
      );
      try {
        setConfig(
          await invoke<ConfigRow[]>("set_chat_config", {
            agent,
            sessionId: sessionRef.current,
            category,
            value,
          }),
        );
      } catch {
        refreshConfig();
      }
    },
    [agent, refreshConfig],
  );

  const ensureSession = useCallback(async () => {
    if (sessionRef.current) return sessionRef.current;
    // One start at a time: StrictMode double-mounts share this promise, so a
    // resume on mount cannot spawn two adapters.
    if (startRef.current) return startRef.current;
    const start = (async () => {
      const requestedResume = resumeRef.current;
      restoringRef.current = Boolean(requestedResume);
      setStarting(true);
      try {
        const onEvent = new Channel<ChatEvent>();
        onEvent.onmessage = applyEvent;
        const session = await invoke<string>("start_chat", {
          path,
          agent,
          onEvent,
          resume: requestedResume,
        });
        if (closedRef.current) {
          // The user switched projects while the adapter was starting; without
          // this, the session outlives its column until app exit.
          invoke("close_chat", { sessionId: session }).catch(() => {});
          throw new Error("chat closed");
        }
        sessionRef.current = session;
        resumeRef.current = null;
        onSessionRef.current(session);
        // The live session is authoritative: it may have clamped a remembered
        // pick the account no longer offers.
        refreshConfig();
        return session;
      } finally {
        startRef.current = null;
        setStarting(false);
      }
    })();
    startRef.current = start;
    return start;
  }, [path, agent, applyEvent, refreshConfig]);

  const restoreSession = useCallback(async () => {
    try {
      await ensureSession();
    } catch (e) {
      const message = String(e);
      if (message === "Error: chat closed") return;
      const trouble = isClaude ? claudeNote(message) : null;
      if (trouble) {
        setItems((list) => withNote(list, trouble));
      } else if (message.includes("auth_required")) {
        setAuthNeeded("resume");
      } else {
        setItems((list) => [...list, { kind: "note", text: message }]);
      }
    }
  }, [ensureSession, isClaude]);

  useEffect(() => {
    // A history session replays its transcript when it opens, not on the first send; reuse this path after sign-in.
    if (resume) restoreSession();
  }, [resume, restoreSession]);

  const send = useCallback(
    async (text: string, files: string[]) => {
      sendingRef.current = true;
      const startedAt = Date.now();
      const localId = nextLocalIdRef.current++;
      // Claude's turn is stored, not replayed, so the line comes back from the
      // project instead of living here for the session.
      if (!isClaude) {
        setItems((list) => [
          ...list,
          {
            kind: "user",
            text,
            files: files.length ? files.map(basename) : undefined,
            localId,
          },
        ]);
      }
      setBusy(true);
      onBusyRef.current(true);
      setAuthNeeded("none");
      let completed = false;
      let stored = false;
      try {
        const session = await ensureSession();
        if (isClaude) {
          await addMessage(projectId, "user", text);
          stored = true;
        }
        await invoke<string>("send_prompt", {
          sessionId: session,
          text,
          part: part ?? null,
          attachments: files,
        });
        completed = true;
      } catch (e) {
        const message = String(e);
        const trouble = isClaude ? claudeNote(message) : null;
        if (trouble || message.includes("auth_required")) {
          // Nothing was sent. Restore it ahead of any next draft composed
          // during the turn, and keep both turns' attachments.
          if (!stored) {
            setItems((list) =>
              list.filter((item) => item.kind !== "user" || item.localId !== localId),
            );
            if (inputRef.current) {
              inputRef.current.value = restoreDraftText(text, inputRef.current.value);
            }
            attachmentDraft.restore(files);
          }
          if (trouble) setItems((list) => withNote(list, trouble));
          else setAuthNeeded("resend");
        } else {
          setItems((list) => withNote(list, message));
        }
      } finally {
        sendingRef.current = false;
        setBusy(false);
        onBusyRef.current(false);
        setPermissions([]);
        // Only successful turns long enough to wander away from earn a chime;
        // quick back-and-forth and failures should stay quiet.
        if (shouldPlayCompletionChime(completed, Date.now() - startedAt)) playChime();
      }
    },
    [ensureSession, part, attachmentDraft, isClaude, projectId],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const box = inputRef.current;
    const text = box?.value.trim() ?? "";
    // sendingRef, not busy: two Enters in one tick both read the stale state,
    // and a double send would spawn a second adapter. A photo alone is a
    // legitimate message ("model this"), so attachments count as content.
    if (
      (!text && !attachmentDraft.hasContent) ||
      sendingRef.current ||
      starting ||
      startRef.current
    )
      return;
    // Reserve the turn before waiting: a second Enter must not queue another
    // send while a pasted image is still crossing the IPC boundary.
    sendingRef.current = true;
    if (box) box.value = "";
    const files = await attachmentDraft.take();
    if (!text && files.length === 0) {
      sendingRef.current = false;
      return;
    }
    send(text, files);
  };

  const attach = async () => {
    const picked = await open({ multiple: true, title: "Attach files" });
    if (!picked) return;
    const paths = Array.isArray(picked) ? picked : [picked];
    attachmentDraft.add(paths);
  };

  // A pasted image (a screenshot, or an image copied from another app) has no
  // path, so the backend writes it to a temporary file that attaches like a
  // dropped one. Consuming the paste keeps a copied file's name out of the text.
  const paste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((blob): blob is File => blob !== null);
    if (images.length === 0) return;
    event.preventDefault();
    const saved = Promise.all(
      images.map((blob) =>
        blob.arrayBuffer().then((bytes) =>
          invoke<string>("save_pasted_image", new Uint8Array(bytes), {
            headers: { mime: blob.type },
          }),
        ),
      ),
    );
    attachmentDraft.track(saved).catch((e) =>
      setItems((list) => [...list, { kind: "note", text: String(e) }]),
    );
  };

  const keydown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const cancel = () => {
    const session = sessionRef.current;
    if (session) invoke("cancel_turn", { sessionId: session }).catch(() => {});
  };

  const signIn = async () => {
    const needsResend = authNeeded === "resend";
    const needsRestore = authNeeded === "resume";
    setSigningIn(true);
    try {
      if (!(await onSignIn(agent))) return;
      setAuthNeeded("none");
      if (needsRestore) await restoreSession();
      // Only a refused message needs sending again; a proactive sign-in has nothing to repeat.
      if (needsResend) {
        setItems((list) => [
          ...list,
          { kind: "note", text: "Signed in. Send your message again." },
        ]);
      }
    } catch (e) {
      setItems((list) => [...list, { kind: "note", text: String(e) }]);
      // Keep retry visible even though the failure adds an item to the transcript.
      setAuthNeeded((state) => state === "none" ? "sign-in" : state);
    } finally {
      setSigningIn(false);
    }
  };

  const answerPermission = (permission: Permission, optionId: string) => {
    const session = sessionRef.current;
    if (!session) return;
    setPermissions((list) => list.filter((p) => p.id !== permission.id));
    invoke("respond_permission", {
      sessionId: session,
      requestId: permission.id,
      optionId,
    }).catch(() => {});
  };

  return (
    <section className={hidden ? "chat chat-hidden" : "chat"}>
      <div className="chat-header" data-tauri-drag-region>
        {/* The part name is the only thing here allowed to truncate, so the
            switcher lives beside it rather than inside it. */}
        <span className="chat-header-left">
          <span className="chat-header-label">{isProject ? "project" : part}</span>
          <span aria-hidden="true">·</span>
          {agents.length > 1 ? (
            <span className="chat-switcher">
              <button
                type="button"
                className="chat-switcher-button"
                aria-expanded={switching}
                disabled={busy || starting}
                title={
                  said
                    ? "switch agents, which starts a fresh conversation"
                    : "switch agents"
                }
                onClick={() => setSwitching((open) => !open)}
              >
                {label}
                <Icon name="chevron-down" className="size-3" />
              </button>
              {switching && (
                <>
                  <div className="chat-switcher-away" onClick={() => setSwitching(false)} />
                  <div className="chat-switcher-menu">
                    {agents.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        className={
                          option.id === agent ? "chat-switcher-item current" : "chat-switcher-item"
                        }
                        onClick={() => {
                          setSwitching(false);
                          if (option.id !== agent) onAgent(option.id, !said);
                        }}
                      >
                        {option.label}
                        {option.loggedIn === false && (
                          <span className="chat-switcher-hint">sign in</span>
                        )}
                      </button>
                    ))}
                    {said && (
                      <p className="chat-switcher-note">
                        Switching starts a fresh conversation. This one is kept.
                      </p>
                    )}
                  </div>
                </>
              )}
            </span>
          ) : (
            <span>{label}</span>
          )}
        </span>
        {said && (
          <button
            className="chat-fresh"
            title="set this conversation aside and start a fresh one"
            disabled={busy || starting}
            onClick={onFresh}
          >
            <Icon name="chat" className="size-3.5" />
            start fresh
          </button>
        )}
      </div>
      <div className="chat-transcript" ref={scrollRef}>
        {!said && !busy && (
          <div className="chat-empty">
            {isProject
              ? `This conversation covers the whole project. Ask ${label} for new parts, or for changes every part should share.`
              : `You're chatting with ${part}. Describe it or ask for changes, and ${label} will model it in the viewer.`}
          </div>
        )}
        {/* Nothing said yet and the agent is known to be signed out: ask before the first message bounces. */}
        {!said && !starting && authNeeded === "none" && signedOut && (
          <div className="chat-auth">
            {isClaude ? (
              CLAUDE_SIGN_IN
            ) : (
              <>
                Sign in to {label} to start.{" "}
                <button className="chat-auth-button" disabled={signingIn} onClick={signIn}>
                  {signingIn ? "signing in…" : "sign in"}
                </button>
              </>
            )}
          </div>
        )}
        {ordered.map((message) => (
          <Stored key={message.id} message={message} />
        ))}
        {items.map((item, index) => {
          switch (item.kind) {
            case "user":
              return (
                <div key={index} className="chat-user">
                  {item.text}
                  {item.files && (
                    <span className="chat-user-files">
                      {item.files.map((name, i) => (
                        <span key={i} className="chat-user-file">
                          {name}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              );
            case "agent":
              return (
                <div key={index} className="text-chat text-ink-soft">
                  <AssistantMarkdown content={item.text} streaming />
                </div>
              );
            case "thought":
              return (
                <details key={index} className="chat-thought">
                  <summary>thinking</summary>
                  <div>{item.text}</div>
                </details>
              );
            case "step":
              return <ToolStepCard key={item.step.id} step={item.step} />;
            case "plan":
              return (
                <ul key={index} className="chat-plan">
                  {item.entries.map((entry, i) => (
                    <li key={i} className={entry.status}>
                      {entry.content}
                    </li>
                  ))}
                </ul>
              );
            case "note":
              return (
                <div key={index} className="chat-note">
                  {item.text}
                </div>
              );
          }
        })}
        {starting && (
          <div className="chat-status">
            {restoringRef.current ? "restoring conversation…" : `starting ${label}…`}
          </div>
        )}
        {/* A first build can run ten minutes or more; a silent transcript
            reads as a hang, so the turn keeps a heartbeat on screen. Hidden
            while a dialog is up, since then it is the user's move. */}
        {busy && !starting && permissions.length === 0 && (
          <div className="chat-working">
            <span className="chat-working-dot" aria-hidden="true" />
            {label} is working…
          </div>
        )}
        {authNeeded !== "none" && (
          <div className="chat-auth">
            {label} isn't signed in on this Mac.{" "}
            <button
              className="chat-auth-button"
              disabled={signingIn}
              onClick={signIn}
            >
              {signingIn ? "signing in…" : "sign in"}
            </button>
          </div>
        )}
        {permissions.map((permission) => (
          <div key={permission.id} className="chat-permission">
            <div className="chat-permission-title">
              {(() => {
                // The permission event carries no tool kind, so only pattern
                // matches translate; anything else reads as "use: <title>".
                // The Rust fallback title is already a full sentence.
                if (permission.title.startsWith(`${label} `)) return permission.title;
                const asked = describe(permission.title, undefined, 1);
                return asked === permission.title
                  ? `${label} wants to use: ${permission.title}`
                  : `${label} wants to ${asked}`;
              })()}
            </div>
            <div className="chat-permission-options">
              {permission.options.map((option) => (
                <button
                  key={option.optionId}
                  className={`chat-permission-button ${option.kind}`}
                  onClick={() => answerPermission(permission, option.optionId)}
                >
                  {option.name}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <form
        className={dropping ? "chat-composer dropping" : "chat-composer"}
        onSubmit={submit}
      >
        {attachments.length > 0 && (
          <div className="chat-attachments">
            {attachments.map((path) => (
              <span key={path} className="chat-attachment">
                <span className="chat-attachment-name">{basename(path)}</span>
                <button
                  type="button"
                  className="chat-attachment-remove"
                  aria-label={`remove ${basename(path)}`}
                  onClick={() => attachmentDraft.remove(path)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={inputRef}
          className="chat-input"
          placeholder={
            busy
              ? `${label} is working…`
              : starting
                ? restoringRef.current
                  ? "Restoring conversation…"
                  : `Starting ${label}…`
                : `Describe or change ${isProject ? "the project" : part}…`
          }
          rows={2}
          disabled={starting}
          onKeyDown={keydown}
          onPaste={paste}
        />
        <div className="chat-composer-controls">
          <button
            type="button"
            className="chat-attach"
            title="attach photos or files"
            aria-label="attach photos or files"
            disabled={starting}
            onClick={attach}
          >
            <Icon name="plus" className="size-3.5" />
          </button>
          {config.length > 0 && (
            <div className="chat-config">
              <button
                type="button"
                className="chat-config-button"
                aria-expanded={picking}
                title={`${label} is set to ${summarize(config)}`}
                onClick={() => setPicking((open) => !open)}
              >
                {summarize(config)}
              </button>
              {picking && (
                <>
                  {/* Click-away, rather than a document listener that has to be
                      taught which clicks are its own. */}
                  <div className="chat-config-away" onClick={() => setPicking(false)} />
                  <div className="chat-config-menu">
                    {config.map((row) => (
                      <label key={row.category} className="chat-config-row">
                        <span>{row.name}</span>
                        <select
                          value={row.value}
                          disabled={busy || starting}
                          onChange={(event) => pick(row.category, event.target.value)}
                        >
                          {row.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                    <p className="chat-config-note">
                      {busy
                        ? `Wait for ${label} to finish to change these.`
                        : "Bigger models and higher effort use up your plan faster."}
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
          {busy ? (
            <button type="button" className="chat-send chat-stop" onClick={cancel}>
              stop
            </button>
          ) : (
            <button type="submit" className="chat-send" disabled={starting}>
              send
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

export default Chat;
