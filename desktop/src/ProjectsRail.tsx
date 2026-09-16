import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Icon } from "@nurb/ui";
import { deleteProject, type Project, type ProjectSummary } from "@nurb/workbench/api";
import PartList from "@nurb/workbench/PartList";
import { ask } from "@tauri-apps/plugin-dialog";

// The caption wants a coarse age ("2M"), not the live counter elapsedLabel
// renders for a running build.
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds)) return "just now";
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

type Props = {
  projects: ProjectSummary[];
  projectId: string | null;
  project: Project | null;
  partName: string | null;
  collapsed: Record<string, boolean>;
  onToggle: (id: string) => void;
  onSelectProject: (id: string) => void;
  onSelectPart: (name: string) => void;
  onNewProject: () => void;
  onImportFolder: () => void;
  onRemoved: (id: string) => void;
  status: string | null;
  busy: boolean;
  footer: React.ReactNode;
};

export default function ProjectsRail({
  projects,
  projectId,
  project,
  partName,
  collapsed,
  onToggle,
  onSelectProject,
  onSelectPart,
  onNewProject,
  onImportFolder,
  onRemoved,
  status,
  busy,
  footer,
}: Props) {
  const [menu, setMenu] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    // The trigger toggles itself on click, so a pointerdown on it must not close
    // the menu first and leave the click reopening what the user meant to dismiss.
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenu(null);
      // Escape hands the keyboard back to the button that opened the menu.
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  // The rail is a tree with one tab stop; arrows walk the rows that are visible.
  const rows = () =>
    Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? [],
    );

  const move = (from: HTMLElement, delta: number) => {
    const all = rows();
    const next = all[all.indexOf(from) + delta];
    next?.focus();
  };

  const remove = async (summary: ProjectSummary) => {
    setMenu(null);
    const yes = await ask(`Remove ${summary.name}? Its parts go with it.`, {
      title: "nurb",
      okLabel: "Remove",
      cancelLabel: "Keep",
    });
    if (!yes) return;
    try {
      await deleteProject(summary.id);
      onRemoved(summary.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const parts = project?.parts ?? [];
  const selectedPart = parts.find((p) => p.name === partName) ?? parts[0] ?? null;

  return (
    <nav className="panel flex w-[248px] shrink-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-1">
        <span className="mono-label chrome text-muted">Projects</span>
        <button
          type="button"
          aria-label="New project"
          onClick={onNewProject}
          className="ml-auto grid size-6 place-items-center rounded-control text-faint hover:bg-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <Icon name="plus" className="size-3.5" />
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="flex flex-col gap-2 px-3 py-3">
          <button
            type="button"
            onClick={onNewProject}
            className="btn-label chrome h-7 rounded-control bg-accent px-3 text-white hover:bg-accent-hover"
          >
            New project
          </button>
          <button
            type="button"
            onClick={onImportFolder}
            disabled={busy}
            className="btn-label chrome h-7 rounded-control border border-line bg-ground px-3 text-ink-soft hover:bg-raised disabled:text-faint"
          >
            {busy ? "Importing…" : "Import folder"}
          </button>
        </div>
      ) : (
        <ul
          ref={listRef}
          role="tree"
          aria-label="Projects"
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {projects.map((summary, index) => {
            const selected = summary.id === projectId;
            const open = selected && !collapsed[summary.id];
            const built = summary.last_built
              ? ` · Built ${ago(summary.last_built)}`
              : "";
            return (
              <li
                key={summary.id}
                role="treeitem"
                aria-expanded={open}
                aria-selected={selected}
              >
                <div
                  data-row
                  tabIndex={selected || (!projectId && index === 0) ? 0 : -1}
                  role="button"
                  onClick={() => onSelectProject(summary.id)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      move(e.currentTarget, 1);
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      move(e.currentTarget, -1);
                    } else if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelectProject(summary.id);
                    } else if (e.key === "ArrowLeft") {
                      if (selected && !collapsed[summary.id]) onToggle(summary.id);
                    } else if (e.key === "ArrowRight") {
                      if (selected && collapsed[summary.id]) onToggle(summary.id);
                      else onSelectProject(summary.id);
                    }
                  }}
                  className={clsx(
                    "group relative flex cursor-default flex-col rounded-content px-2 py-1.5",
                    "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                    selected ? "bg-accent-wash" : "hover:bg-raised",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      aria-label={open ? "Collapse" : "Expand"}
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (selected) onToggle(summary.id);
                        else onSelectProject(summary.id);
                      }}
                      className="grid size-4 shrink-0 place-items-center text-faint"
                    >
                      <Icon
                        name="chevron-down"
                        className={clsx("size-3 transition-transform", !open && "-rotate-90")}
                      />
                    </button>
                    <span className="mono-value truncate text-ink">{summary.name}</span>
                    <button
                      type="button"
                      ref={menu === summary.id ? triggerRef : null}
                      aria-label={`Actions for ${summary.name}`}
                      aria-expanded={menu === summary.id}
                      tabIndex={-1}
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenu(menu === summary.id ? null : summary.id);
                      }}
                      className="ml-auto hidden size-5 shrink-0 place-items-center rounded-control text-faint hover:bg-raised group-hover:grid group-focus-within:grid"
                    >
                      <Icon name="dots" className="size-3.5" />
                    </button>
                  </div>
                  <div className="mono-caption pl-[22px] text-muted">
                    {summary.parts} {summary.parts === 1 ? "part" : "parts"}
                    {built}
                  </div>
                  {menu === summary.id && (
                    <div ref={menuRef} className="panel absolute top-full right-2 z-10 p-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void remove(summary);
                        }}
                        className="btn-label chrome w-full rounded-control px-3 py-1.5 text-left text-fail hover:bg-raised"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </div>

                {open && (
                  <div role="group" className="pl-[22px]">
                    {parts.length === 0 ? (
                      <div className="mono-caption px-2 py-1.5 text-muted">No parts yet</div>
                    ) : (
                      <PartList parts={parts} selected={selectedPart} onSelect={onSelectPart} />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {(status || error) && (
        <div className="mono-caption shrink-0 px-3 pb-2 text-fail" role="alert">
          {status ?? error}
        </div>
      )}
      <div className="mt-auto shrink-0">{footer}</div>
    </nav>
  );
}
