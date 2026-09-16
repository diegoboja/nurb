import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { fetchProjects, type ProjectSummary } from "./api"
import { useLive } from "./live"
import { readSelection, writeSelection } from "./selection"
import PartList from "./PartList"
import PartView from "./PartView"
import Transcript from "./Transcript"
import { useProject } from "./useProject"

export default function App() {
  const initial = useMemo(readSelection, [])
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectId, setProjectId] = useState<string | null>(initial.project)
  const [partName, setPartName] = useState<string | null>(initial.part)
  const [loadedProjects, setLoadedProjects] = useState(false)

  // Two lists land at once after a build, so an older answer can arrive last.
  const listSeq = useRef(0)

  const loadProjects = useCallback(async () => {
    const seq = ++listSeq.current
    const data = await fetchProjects().catch(() => null)
    if (!data || seq !== listSeq.current) return
    setProjects(data.projects)
    setLoadedProjects(true)
    setProjectId((current) => current ?? data.projects[0]?.id ?? null)
  }, [])

  const { project, missing } = useProject(projectId)

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  // The link named a project that is gone, so fall back to one that is here.
  useEffect(() => {
    if (!missing) return
    setProjectId(null)
    void loadProjects()
  }, [missing, loadProjects])

  useLive((event) => {
    // A reconnect arrives with no project, so the list refetches too. Every project
    // event refetches, because one is how a project arrives and how it goes, and
    // "already in the list" is exactly the case a delete leaves behind.
    if (!event.project_id || event.kind === "project") void loadProjects()
  })

  const parts = project?.parts ?? []
  const part = parts.find((p) => p.name === partName) ?? parts[0] ?? null

  useEffect(() => {
    // Until the project has loaded there is no resolved part, and writing then
    // would strip the part the deep link asked for.
    if (projectId && project?.id !== projectId) return
    writeSelection({ project: projectId, part: part?.name ?? null })
  }, [projectId, project?.id, part?.name])

  if (loadedProjects && projects.length === 0) {
    return (
      <main className="flex h-dvh items-center justify-center p-8">
        <div className="panel flex max-w-sm flex-col gap-2 p-6 text-center">
          <h1 className="mono-value text-ink">No projects yet</h1>
          <p className="mono-caption text-muted">
            Add the nurb connection to your agent and ask it to create a project.
          </p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-dvh flex-col gap-4 p-4">
      <PartView
        project={project}
        partName={partName}
        headerStart={
          <label className="mono-caption flex items-center gap-2 text-muted">
            <span>Project</span>
            <select
              aria-label="Project"
              value={projectId ?? ""}
              onChange={(e) => {
                setProjectId(e.target.value)
                setPartName(null)
              }}
              className="mono-value rounded-control border border-line bg-ground px-2 py-1 text-ink"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        }
        aside={
          <div className="panel flex w-[372px] shrink-0 flex-col overflow-hidden max-lg:order-last max-lg:w-full">
            <PartList parts={parts} selected={part} onSelect={setPartName} />
            <Transcript messages={project?.messages ?? []} />
          </div>
        }
      />
    </main>
  )
}
