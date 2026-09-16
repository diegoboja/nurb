import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ask, message, open as pickFolder } from "@tauri-apps/plugin-dialog";
import { check, Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { Icon } from "@nurb/ui";
import {
  configure,
  createProject,
  fetchProjects,
  importFolder,
  openPublic,
  type ProjectSummary,
} from "@nurb/workbench/api";
import { reconnect, useLive } from "@nurb/workbench/live";
import { useProject } from "@nurb/workbench/useProject";
import PartView from "@nurb/workbench/PartView";
import About from "./About";
import AgentsHelp from "./AgentsHelp";
import Chat, { AGENT_LABEL, PROJECT_CHAT } from "./Chat";
import GeminiKeyDialog from "./GeminiKeyDialog";
import {
  chatKey,
  markChatSeen,
  retainChatColumns,
  updateChatActivity,
  type ChatColumn,
} from "./chatColumns";
import { createLatestRequestGate } from "./latestRequest";
import { srcOf } from "./openLink";
import ProjectsRail from "./ProjectsRail";
import Setup from "./Setup";
import Settings from "./Settings";

type AboutInfo = {
  appVersion: string;
  nurbVersion: string;
  occtVersion: string | null;
  osVersion: string;
  arch: string;
};

type ServeInfo = {
  url: string;
  port: number;
  pid: number;
  token: string;
};

type AgentStatus = {
  id: string;
  label: string;
  installed: boolean;
  loggedIn: boolean | null;
  detail: string | null;
  note: string;
  install: string | null;
};

const PROJECT_KEY = "nurb.project";

const readProject = () => {
  try {
    return localStorage.getItem(PROJECT_KEY);
  } catch {
    return null;
  }
};

const writeProject = (id: string | null) => {
  try {
    if (id) localStorage.setItem(PROJECT_KEY, id);
    else localStorage.removeItem(PROJECT_KEY);
  } catch {
    // A locked storage is not a reason to lose the selection this run.
  }
};

/// Waiting for the serve, or reporting why it never came up.
function EngineStarting({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (error) return;
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [error]);
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-stage p-8" data-tauri-drag-region>
      {error ? (
        <>
          <p className="text-chat max-w-sm text-center text-ink">{error}</p>
          <button
            type="button"
            onClick={onRetry}
            className="btn-label chrome h-8 rounded-control bg-accent px-4 text-white hover:bg-accent-hover"
          >
            Retry
          </button>
        </>
      ) : (
        <>
          <p className="text-chat text-ink">Starting the CAD engine…</p>
          {seconds >= 10 && (
            <p className="mono-caption text-on-stage-muted">
              {seconds}s · a cold start can take a few minutes when the computer is busy
            </p>
          )}
        </>
      )}
    </div>
  );
}

function EmptyState({
  small,
  onNew,
  onImport,
  busy,
  error,
}: {
  small: boolean;
  onNew: () => void;
  onImport: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="panel flex max-w-[420px] flex-col gap-3 p-6">
        {small ? (
          <p className="text-chat text-muted">
            No parts in this project yet. Ask your agent for one, or import a folder.
          </p>
        ) : (
          <>
            <h1 className="font-display text-[20px] leading-6 text-ink">Nothing on the plate yet</h1>
            <p className="text-chat text-muted">
              Start a project and describe the part you want. Or point nurb at a folder you already have.
            </p>
          </>
        )}
        <div className="flex gap-2">
          {!small && (
            <button
              type="button"
              onClick={onNew}
              className="btn-label chrome h-8 rounded-control bg-accent px-4 text-white hover:bg-accent-hover"
            >
              New project
            </button>
          )}
          <button
            type="button"
            onClick={onImport}
            disabled={busy}
            className="btn-label chrome h-8 rounded-control border border-line bg-ground px-4 text-ink-soft hover:bg-raised disabled:text-faint"
          >
            {busy ? "Importing…" : "Import folder"}
          </button>
        </div>
        {error && <p className="mono-caption text-fail">{error}</p>}
      </div>
    </div>
  );
}

function App() {
  // null while the check runs, false when first-launch provisioning has work
  // to do, true once the environment is healthy and the app can start.
  const [ready, setReady] = useState<boolean | null>(null);
  const [served, setServed] = useState(false);
  // Settings hands this endpoint to a coding assistant on the same Mac.
  const [serveInfo, setServeInfo] = useState<ServeInfo | null>(null);
  const [serveError, setServeError] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(readProject);
  const [partName, setPartName] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [emptyError, setEmptyError] = useState<string | null>(null);
  const [railStatus, setRailStatus] = useState<string | null>(null);
  const listSeq = useRef(0);

  // The agent's working directory for each project, resolved once and reused:
  // a chat column cannot mount before it has one.
  const [dirs, setDirs] = useState<Record<string, string>>({});

  const [columns, setColumns] = useState<ChatColumn[]>([]);
  const [busyChats, setBusyChats] = useState<Record<string, boolean>>({});
  const busyRef = useRef(busyChats);
  busyRef.current = busyChats;

  const [agentStatuses, setAgentStatuses] = useState<AgentStatus[]>([]);
  const [agentStatusState, setAgentStatusState] = useState<"loading" | "ready" | "error">("loading");
  const agentStatusRequests = useRef(createLatestRequestGate());
  const [signingIn, setSigningIn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [defaultAgent, setDefaultAgent] = useState(
    () => localStorage.getItem("nurb-default-agent") ?? "claude",
  );

  const [about, setAbout] = useState<AboutInfo | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showAgentsHelp, setShowAgentsHelp] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const geminiKeyResolver = useRef<((key: string | null) => void) | null>(null);

  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const found = useRef<{ update: Update; ready: Promise<boolean> } | null>(null);

  useEffect(() => {
    invoke<boolean>("provision_status")
      .then(setReady)
      .catch(() => setReady(false));
  }, []);

  // One serve per app. `resolve` runs before every socket reconnect, so a
  // crashed engine comes back on whatever port the new one took.
  const startServe = useCallback(async () => {
    setServeError(null);
    try {
      const info = await invoke<ServeInfo>("serve_info");
      setServeInfo(info);
      configure({
        base: info.url,
        resolve: async () => {
          // A restarted engine can land on another port; Settings shows this.
          const next = await invoke<ServeInfo>("serve_info");
          setServeInfo(next);
          return next.url;
        },
      });
      // The live hooks subscribed on first render, against the page's own origin.
      reconnect();
      setServed(true);
    } catch (e) {
      setServeError(String(e));
    }
  }, []);

  useEffect(() => {
    if (ready === true && !served) void startServe();
  }, [ready, served, startServe]);

  const loadProjects = useCallback(async () => {
    const seq = ++listSeq.current;
    const data = await fetchProjects().catch(() => null);
    if (!data || seq !== listSeq.current) return;
    setProjects(data.projects);
    setProjectId((current) =>
      current && data.projects.some((p) => p.id === current)
        ? current
        : data.projects[0]?.id ?? null,
    );
  }, []);

  useEffect(() => {
    if (served) void loadProjects();
  }, [served, loadProjects]);

  const { project, missing } = useProject(served ? projectId : null);

  // A remembered id whose project is gone clears itself.
  useEffect(() => {
    if (!missing) return;
    setProjectId(null);
    void loadProjects();
  }, [missing, loadProjects]);

  useLive((event) => {
    // The rail's part count and built time move on a build, not only on a
    // project event, so both refetch the list.
    if (event.kind === "project" || event.kind === "build") void loadProjects();
  });

  useEffect(() => writeProject(projectId), [projectId]);

  const selectProject = useCallback((id: string) => {
    setProjectId(id);
    setPartName(null);
    setRailStatus(null);
  }, []);

  useEffect(() => {
    // A remembered id may name a project that is gone, and asking for its folder
    // would create one. Wait until the list says the project is really there.
    if (!projectId || dirs[projectId]) return;
    if (!projects.some((p) => p.id === projectId)) return;
    invoke<string>("project_dir", { projectId })
      .then((dir) => setDirs((map) => ({ ...map, [projectId]: dir })))
      .catch((e) => setError(String(e)));
  }, [projectId, dirs, projects]);

  // One chat per project, mounted for as long as its turn runs.
  useEffect(() => {
    if (!projectId || !dirs[projectId]) return;
    const dir = dirs[projectId];
    // The last conversation picks up where it left off, under the agent that
    // ran it; a project with no saved chat starts fresh with the default.
    invoke<{ sessionId: string; agent: string } | null>("saved_chat", {
      projectId,
      part: PROJECT_CHAT,
    })
      .catch(() => null)
      .then((saved) =>
        setColumns((list) =>
          list.some((col) => col.path === dir)
            ? list
            : [
                ...list,
                {
                  path: dir,
                  part: PROJECT_CHAT,
                  agent: saved?.agent ?? null,
                  resume: saved?.sessionId ?? null,
                  gen: 0,
                  unseen: false,
                },
              ],
        ),
      );
  }, [projectId, dirs]);

  const activeDir = projectId ? dirs[projectId] ?? null : null;

  useEffect(() => {
    setColumns((list) => retainChatColumns(list, activeDir, busyRef.current));
  }, [activeDir]);

  useEffect(() => {
    if (activeDir) setColumns((list) => markChatSeen(list, activeDir, PROJECT_CHAT));
  }, [activeDir]);

  const findUpdate = useCallback(async () => {
    if (!import.meta.env.PROD || found.current) return found.current?.update ?? null;
    const next = await check();
    if (next && !found.current) {
      found.current = { update: next, ready: next.download().then(() => true, () => false) };
      setUpdate(next);
    }
    return next;
  }, []);

  useEffect(() => {
    findUpdate().catch(() => {});
    const timer = setInterval(() => findUpdate().catch(() => {}), 6 * 60 * 60 * 1000);
    return () => clearInterval(timer);
  }, [findUpdate]);

  useEffect(() => {
    if (ready !== true) return;
    invoke<AboutInfo>("about_info").then(setAbout).catch(() => {});
  }, [ready]);

  const installUpdate = useCallback(async () => {
    if (!found.current || updating) return;
    setUpdating(true);
    setError(null);
    try {
      const pending = found.current;
      if (await pending.ready) await pending.update.install();
      else await pending.update.downloadAndInstall();
      await relaunch();
    } catch (e) {
      setError(String(e));
      setUpdating(false);
    }
  }, [updating]);

  // The macOS "Check for Updates…" item lives in Rust; the update state lives
  // here, so the click arrives as an event.
  useEffect(() => {
    const unlisten = listen("menu:check-updates", async () => {
      if (!import.meta.env.PROD) return;
      try {
        const next = await findUpdate();
        if (!next) {
          await message("You're on the newest version.", { title: "nurb" });
        } else if (
          await ask(`nurb ${next.version} is ready to install.`, {
            title: "nurb",
            okLabel: "Restart & Update",
            cancelLabel: "Later",
          })
        ) {
          await installUpdate();
        }
      } catch (e) {
        setError(String(e));
      }
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [findUpdate, installUpdate]);

  const refreshAgents = useCallback(async () => {
    const isLatest = agentStatusRequests.current.begin();
    setAgentStatusState((state) => (state === "ready" ? state : "loading"));
    try {
      const statuses = await invoke<AgentStatus[]>("agent_statuses");
      if (!isLatest()) return;
      setAgentStatuses(statuses);
      setAgentStatusState("ready");
    } catch (e) {
      if (isLatest()) setAgentStatusState((state) => (state === "ready" ? state : "error"));
      throw e;
    }
  }, []);

  useEffect(() => {
    if (ready === true) refreshAgents().catch(() => {});
  }, [ready, refreshAgents]);

  // Signing in happens outside this window, so coming back is when to notice.
  useEffect(() => {
    if (ready !== true) return;
    const onFocus = () => refreshAgents().catch(() => {});
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [ready, refreshAgents]);

  const chooseAgent = (id: string) => {
    setDefaultAgent(id);
    localStorage.setItem("nurb-default-agent", id);
  };

  const requestGeminiKey = () =>
    new Promise<string | null>((resolve) => {
      geminiKeyResolver.current = resolve;
      setShowGeminiKey(true);
    });

  const finishGeminiKey = (key: string | null) => {
    setShowGeminiKey(false);
    geminiKeyResolver.current?.(key);
    geminiKeyResolver.current = null;
  };

  const signInAgent = async (id: string): Promise<boolean> => {
    const apiKey = id === "gemini" ? await requestGeminiKey() : null;
    if (id === "gemini" && apiKey === null) return false;
    setSigningIn(id);
    setError(null);
    try {
      await invoke("agent_login", { agent: id, apiKey });
      await refreshAgents();
      return true;
    } catch (e) {
      setError(String(e));
      throw e;
    } finally {
      setSigningIn(null);
    }
  };

  const newProject = useCallback(async () => {
    setEmptyError(null);
    try {
      const created = await createProject();
      await loadProjects();
      selectProject(created.id);
      return created.id;
    } catch (e) {
      setEmptyError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [loadProjects, selectProject]);

  const runImport = useCallback(
    async (path: string) => {
      setEmptyError(null);
      setImporting(true);
      try {
        const imported = await importFolder(path);
        await loadProjects();
        selectProject(imported.id);
      } catch (e) {
        setEmptyError(e instanceof Error ? e.message : String(e));
      } finally {
        setImporting(false);
      }
    },
    [loadProjects, selectProject],
  );

  const pickAndImport = useCallback(async () => {
    const picked = await pickFolder({ directory: true, title: "Choose a folder to import" });
    if (typeof picked === "string") await runImport(picked);
  }, [runImport]);

  // Deep links: the ones the app launched with, then the live ones.
  const openSrc = useCallback(
    async (url: string) => {
      const src = srcOf(url);
      if (!src) return;
      try {
        const opened = await openPublic(src);
        await loadProjects();
        setProjectId(opened.project_id);
        setPartName(opened.part);
        setRailStatus(null);
      } catch (e) {
        setRailStatus(e instanceof Error ? e.message : String(e));
      }
    },
    [loadProjects],
  );

  useEffect(() => {
    if (!served) return;
    invoke<string[]>("pending_open_urls")
      .then((urls) => urls.forEach((url) => void openSrc(url)))
      .catch(() => {});
    const unlisten = listen<string>("nurb-open", (event) => void openSrc(event.payload));
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [served, openSrc]);

  // Patched once for the life of the page. Inside the listener effect below
  // these would stack: one more wrapper and one more listener per refetch.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const report = (text: string) => void invoke("debug_log", { text }).catch(() => {});
    const warn = console.warn;
    const error = console.error;
    console.warn = (...args: unknown[]) => { warn(...args); report(`warn: ${args.map(String).join(" ")}`); };
    console.error = (...args: unknown[]) => { error(...args); report(`error: ${args.map(String).join(" ")}`); };
    const onRejection = (e: PromiseRejectionEvent) => report(`unhandled: ${String(e.reason)}`);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      console.warn = warn;
      console.error = error;
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // The list the test hook resolves a name against, read at event time so the
  // listeners below subscribe once instead of on every refetch.
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // The debug hook on 127.0.0.1:7399, so a test can drive the app without
  // touching the keyboard or the mouse.
  useEffect(() => {
    if (!served) return;
    const offs = [
      listen<string>("test-create", async (event) => {
        try {
          const created = await createProject(event.payload);
          await loadProjects();
          selectProject(created.id);
        } catch (e) {
          setEmptyError(String(e));
        }
      }),
      listen<string>("test-open", (event) => {
        const found = projectsRef.current.find((p) => p.name === event.payload);
        if (found) selectProject(found.id);
      }),
      listen<string>("test-import", (event) => void runImport(event.payload)),
      listen<string>("test-part", (event) => setPartName(event.payload)),
      listen<string>("test-param", (event) => {
        // The range input's own events, through React's native setter, so the
        // page sees exactly what a drag produces.
        const [name, value] = event.payload.split("=");
        const input = document.querySelector<HTMLInputElement>(
          `input[type="range"][aria-label="${name.replace(/_/g, " ")}"]`,
        );
        if (!input) return;
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }),
    ];
    return () => {
      // Unregistering a listener the webview already dropped throws, and the
      // page must not carry an unhandled rejection for a teardown that worked.
      offs.forEach((off) => off.then((fn) => fn()).catch(() => {}));
    };
  }, [served, loadProjects, selectProject, runImport]);

  const startFresh = async (path: string, part: string, agent: string | null = null) => {
    if (!projectId) return;
    try {
      await invoke("select_part_chat", { projectId, part, sessionId: null });
    } catch (e) {
      setError(String(e));
      return;
    }
    setColumns((list) =>
      list.map((col) =>
        col.path === path && col.part === part
          ? { ...col, resume: null, agent, gen: col.gen + 1 }
          : col,
      ),
    );
  };

  const chatStarted = (path: string, part: string, id: string, agent: string) => {
    if (projectId) {
      invoke("select_part_chat", { projectId, part, sessionId: id }).catch((e) =>
        setError(String(e)),
      );
    }
    setColumns((list) =>
      list.map((col) =>
        col.path === path && col.part === part ? { ...col, resume: id, agent } : col,
      ),
    );
  };

  const chatBusy = (
    path: string,
    part: string,
    agent: string,
    busy: boolean,
    visible: boolean,
  ) => {
    const key = chatKey(path, part);
    const wasBusy = Boolean(busyRef.current[key]);
    setBusyChats((map) => {
      if (busy) return { ...map, [key]: true };
      if (!(key in map)) return map;
      const { [key]: _, ...rest } = map;
      return rest;
    });
    setColumns((list) => updateChatActivity(list, path, part, agent, busy, visible, wasBusy));
  };

  if (ready === null) return null;
  if (ready === false) return <Setup onDone={() => setReady(true)} />;
  if (!served) return <EngineStarting error={serveError} onRetry={() => void startServe()} />;

  const parts = project?.parts ?? [];
  const chatAgents = agentStatuses
    .filter((status) => status.installed)
    .map((status) => ({
      id: status.id,
      label: AGENT_LABEL[status.id] ?? status.label,
      loggedIn: status.loggedIn,
    }));

  return (
    <div className="flex h-dvh flex-col bg-stage">
      {/* The traffic lights sit at (18,22) over the page, so the top strip is
          both their room and the window's drag handle. */}
      <div className="h-[44px] shrink-0" data-tauri-drag-region />
      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4">
        <ProjectsRail
          projects={projects}
          projectId={projectId}
          project={project}
          partName={partName}
          collapsed={collapsed}
          onToggle={(id) => setCollapsed((map) => ({ ...map, [id]: !map[id] }))}
          onSelectProject={selectProject}
          onSelectPart={setPartName}
          onNewProject={() => void newProject()}
          onImportFolder={() => void pickAndImport()}
          onRemoved={(id) => {
            if (id === projectId) setProjectId(null);
            void loadProjects();
          }}
          status={railStatus ?? error}
          busy={importing}
          footer={
            <div className="flex flex-col gap-1 border-t border-line-soft p-2">
              {update && (
                <button
                  type="button"
                  className="btn-label chrome rounded-control bg-accent px-2 py-1.5 text-white hover:bg-accent-hover"
                  disabled={updating}
                  onClick={() => void installUpdate()}
                >
                  {updating ? "Updating…" : `Update to ${update.version}`}
                </button>
              )}
              <div className="flex items-center gap-2">
                {about && (
                  <button
                    type="button"
                    className="mono-caption chrome rounded-control px-1 text-faint hover:text-ink"
                    onClick={() => setShowAbout(true)}
                  >
                    nurb {about.appVersion}
                  </button>
                )}
                <button
                  type="button"
                  aria-label="Settings"
                  title="Settings"
                  className="ml-auto grid size-6 place-items-center rounded-control text-faint hover:bg-raised hover:text-ink"
                  onClick={() => setShowSettings(true)}
                >
                  <Icon name="gear" className="size-3.5" />
                </button>
              </div>
            </div>
          }
        />

        {projectId && activeDir && (
          <section className="panel flex w-[372px] shrink-0 flex-col overflow-hidden">
            {columns.map((col) => {
              const agent = col.agent ?? defaultAgent;
              const visible = col.path === activeDir;
              return (
                <Chat
                  key={`${col.path}:${col.gen}:${agent}`}
                  path={col.path}
                  part={col.part}
                  messages={visible ? project?.messages ?? [] : []}
                  agent={agent}
                  agents={chatAgents}
                  resume={col.resume}
                  hidden={!visible}
                  onSession={(id) => chatStarted(col.path, col.part, id, agent)}
                  onFresh={() => startFresh(col.path, col.part)}
                  onAgent={(id, unstarted) => {
                    if (unstarted) chooseAgent(id);
                    startFresh(col.path, col.part, id);
                  }}
                  onBusy={(busy) => chatBusy(col.path, col.part, agent, busy, visible)}
                  onSignIn={signInAgent}
                />
              );
            })}
          </section>
        )}

        {projects.length === 0 ? (
          <EmptyState
            small={false}
            onNew={() => void newProject()}
            onImport={() => void pickAndImport()}
            busy={importing}
            error={emptyError}
          />
        ) : parts.length === 0 ? (
          <EmptyState
            small
            onNew={() => void newProject()}
            onImport={() => void pickAndImport()}
            busy={importing}
            error={emptyError}
          />
        ) : (
          <PartView project={project} partName={partName} />
        )}
      </div>

      {showSettings && (
        <Settings
          agents={agentStatuses.filter((status) => status.installed)}
          agentStatusState={agentStatusState}
          signingIn={signingIn}
          serve={serveInfo}
          onSignIn={signInAgent}
          onMoreAgents={() => {
            setShowSettings(false);
            setShowAgentsHelp(true);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      {showGeminiKey && (
        <GeminiKeyDialog
          onSubmit={(key) => finishGeminiKey(key)}
          onClose={() => finishGeminiKey(null)}
        />
      )}
      {showAbout && about && (
        <About
          appVersion={about.appVersion}
          nurbVersion={about.nurbVersion}
          occtVersion={about.occtVersion}
          osVersion={about.osVersion}
          arch={about.arch}
          onClose={() => setShowAbout(false)}
        />
      )}
      {showAgentsHelp && (
        <AgentsHelp
          missing={agentStatuses.filter((status) => !status.installed)}
          onClose={() => {
            setShowAgentsHelp(false);
            refreshAgents().catch(() => {});
          }}
        />
      )}
    </div>
  );
}

export default App;
