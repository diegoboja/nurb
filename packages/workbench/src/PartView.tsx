import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import clsx from "clsx"
import {
  ExportMenu,
  ViewerIsland,
  rev,
  type BuildStats,
  type CameraState,
  type ExportFormat,
  type ExportStatus,
  type Param,
  type Params,
} from "@nurb/ui"
import {
  absolute,
  applyParams,
  buildWithParams,
  exportPart,
  setPrinter,
  type ApplyResult,
  type Project,
} from "./api"
import { loadCamera, saveCamera } from "./camera"
import Rail from "./Rail"
import Slice from "./Slice"
import Stress from "./Stress"
import { verdictCaption, verdictDot, verdictOf } from "./verdict"

// A drag lands many values a second; one rebuild per quarter second is the most a
// real part can keep up with.
const DEBOUNCE_MS = 250

function bedOf(project: Project | null): [number, number] | null {
  const bed = project?.printer?.bed
  return Array.isArray(bed) && bed.length >= 2 ? [Number(bed[0]), Number(bed[1])] : null
}

function cameraReadout(camera: CameraState | null): string | null {
  if (!camera) return null
  const one = (v: number) => v.toFixed(1)
  return `cam ${camera.position.map(one).join(" ")} at ${camera.target.map(one).join(" ")}`
}

function lastLine(text: string): string {
  const lines = text.trim().split("\n")
  return lines[lines.length - 1] || text
}

// One change is worth naming, because the user wants to see it landed where they put
// it. Several are worth counting, because the list would be longer than the rail.
function applyNote(result: ApplyResult, params: Param[], diff: Params): string {
  const written = result.written
  let note: string
  if (written.length === 0) {
    note = "Nothing to save."
  } else if (written.length === 1) {
    const name = written[0]
    const before = params.find((p) => p.name === name)?.default
    note = `Saved as rev ${result.revision}. ${name} ${before} → ${diff[name]}`
  } else {
    note = `Saved as rev ${result.revision}. ${written.length} changes.`
  }
  if (result.skipped.length > 0) note += ` ${result.skipped[0].why}`
  return note
}

export default function PartView({
  project,
  partName,
  headerStart,
  aside,
}: {
  project: Project | null
  partName: string | null
  /** Whatever owns the project belongs at the head of the strip, or nothing at all. */
  headerStart?: ReactNode
  /** A column left of the stage, for a host that has one. */
  aside?: ReactNode
}) {
  const projectId = project?.id ?? null
  const [highlight, setHighlight] = useState<number | null>(null)
  const [camera, setCamera] = useState<CameraState | null>(null)

  const [values, setValues] = useState<Params>({})
  const [building, setBuilding] = useState(false)
  const [applying, setApplying] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [buildError, setBuildError] = useState<string | null>(null)
  const [sliceStatus, setSliceStatus] = useState<ExportStatus | null>(null)

  const paramsSeq = useRef(0)
  const paramsTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const paramsAbort = useRef<AbortController | null>(null)
  const objectUrl = useRef<string | null>(null)

  const parts = project?.parts ?? []
  const part = parts.find((p) => p.name === partName) ?? parts[0] ?? null
  const build = part?.build ?? null
  const verdict = verdictOf(build)
  const glbUrl = build?.glb_url ?? null
  const runId = build?.id ?? null

  // The stored view is the proof a rebuild did not move the camera.
  useEffect(() => {
    if (!projectId || !part) {
      setCamera(null)
      return
    }
    setCamera(loadCamera(projectId, part.name))
    setHighlight(null)
  }, [projectId, part?.name])

  // A part carries the overrides its newest run was built at, so the sliders open
  // where they were left rather than back at the declared defaults.
  useEffect(() => {
    paramsSeq.current += 1
    paramsAbort.current?.abort()
    if (paramsTimer.current) clearTimeout(paramsTimer.current)
    setValues(part?.overrides ?? {})
    setNote(null)
    setBuildError(null)
    setBuilding(false)
    setSliceStatus(null)
  }, [projectId, part?.name])

  // A rebuild queued by the last drag is about a part nobody is looking at any more,
  // so the timer and the request leave with the view.
  useEffect(() => {
    return () => {
      if (paramsTimer.current) clearTimeout(paramsTimer.current)
      paramsAbort.current?.abort()
    }
  }, [])

  // A prepared download is about the geometry it came from, so it goes when that
  // does, and when the page does.
  useEffect(() => {
    return () => {
      if (objectUrl.current) {
        URL.revokeObjectURL(objectUrl.current)
        objectUrl.current = null
      }
    }
  }, [part?.id, runId])

  const sendParams = useCallback(async (partId: string, next: Params) => {
    const seq = ++paramsSeq.current
    paramsAbort.current?.abort()
    const controller = new AbortController()
    paramsAbort.current = controller
    setBuilding(true)
    try {
      const { build: answer } = await buildWithParams(partId, next, controller.signal)
      if (seq !== paramsSeq.current) return
      setBuildError(answer.status === "error" && answer.error ? lastLine(answer.error) : null)
    } catch (failure) {
      // A superseded drag cancels its own request; that is not a failure to report.
      if ((failure as Error | null)?.name === "AbortError" || seq !== paramsSeq.current) return
      setBuildError(failure instanceof Error ? failure.message : "The rebuild did not finish.")
    } finally {
      if (seq === paramsSeq.current) setBuilding(false)
    }
  }, [])

  const onParamsChange = useCallback(
    (next: Params) => {
      setValues(next)
      setNote(null)
      const partId = part?.id
      if (!partId) return
      if (paramsTimer.current) clearTimeout(paramsTimer.current)
      paramsTimer.current = setTimeout(() => void sendParams(partId, next), DEBOUNCE_MS)
    },
    [part?.id, sendParams]
  )

  const onApply = useCallback(
    async (diff: Params) => {
      if (!part) return
      setApplying(true)
      setNote(null)
      try {
        const result = await applyParams(part.id, diff)
        // The refetch brings the new defaults, so nothing is dirty any more.
        setValues({})
        setNote(applyNote(result, part.params, diff))
      } catch (failure) {
        setNote(failure instanceof Error ? failure.message : "The values did not save.")
      } finally {
        setApplying(false)
      }
    },
    [part?.id, part?.params]
  )

  const runExport = useCallback(
    async (format: ExportFormat, profile?: string) => {
      if (!part) throw new Error("There is no part to download yet.")
      // Picking a printer in the menu is picking one for the project; nothing else
      // would make that select mean anything.
      if (profile && projectId && profile !== project?.printer?.name) {
        await setPrinter(projectId, profile)
      }
      const blob = await exportPart(part.id, format, values)
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current)
      objectUrl.current = URL.createObjectURL(blob)
      return { url: objectUrl.current, filename: `${part.name}.${format}` }
    },
    [part?.id, part?.name, projectId, project?.printer?.name, values]
  )

  const onCamera = useCallback(
    (state: CameraState) => {
      if (projectId && part) saveCamera(projectId, part.name, state)
      setCamera(state)
    },
    [projectId, part?.name]
  )

  // The build records its bounding box; the panel's footer reads a size.
  const stats = useMemo<BuildStats | null>(() => {
    const raw = build?.stats
    if (!raw) return null
    return { ...raw, size_mm: (raw.size_mm as BuildStats["size_mm"]) ?? raw.bbox }
  }, [build?.stats])

  // The machine already chosen goes first, because the menu's own first row is what
  // an untouched download uses.
  const profiles = useMemo(() => {
    const all = project?.printers ?? []
    const chosen = project?.printer?.name
    if (!chosen || !all.includes(chosen)) return undefined
    return [chosen, ...all.filter((name) => name !== chosen)]
  }, [project?.printers, project?.printer?.name])

  const readout = cameraReadout(camera)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="panel chrome flex h-[52px] shrink-0 items-center gap-3 px-4">
        {headerStart}
        <span className={clsx("size-2 shrink-0 rounded-full", verdictDot(verdict))} />
        <span className="mono-value text-ink">{part?.name ?? "No part yet"}</span>
        <span className="mono-caption text-muted">{verdictCaption(verdict, build)}</span>
        <span className="ml-auto flex items-center gap-3">
          {readout ? <span className="mono-caption text-faint">{readout}</span> : null}
          <span className="mono-caption text-muted">{rev(part?.revision ?? 0)}</span>
        </span>
      </header>

      <div className="flex min-h-0 flex-1 gap-4 max-lg:flex-col">
        {aside}

        <div
          data-testid="stage"
          data-glb-url={glbUrl ?? ""}
          className="flex min-w-0 flex-1 flex-col gap-2 max-lg:order-first max-lg:h-[420px]"
        >
          {glbUrl ? (
            <ViewerIsland
              key={part?.id}
              glbUrl={absolute(glbUrl)}
              findings={build?.findings ?? []}
              highlight={highlight}
              onHighlight={setHighlight}
              bed={bedOf(project)}
              camera={camera}
              onCamera={onCamera}
              className="min-h-0 flex-1"
            />
          ) : (
            <div className="panel flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
              <p className="mono-caption text-muted">Not built yet</p>
              {part && !build ? (
                <>
                  <button
                    type="button"
                    disabled={building}
                    onClick={() => void sendParams(part.id, {})}
                    className="chrome btn-label inline-flex h-9 items-center gap-2 rounded-control bg-accent px-3 text-white transition-colors hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
                  >
                    {building ? <span className="size-1.5 rounded-full bg-white" /> : null}
                    {building ? "building…" : `Build ${part.name}`}
                  </button>
                  {buildError ? (
                    <p className="mono-caption max-w-sm text-center text-fail">{buildError}</p>
                  ) : null}
                </>
              ) : null}
            </div>
          )}
          {build?.status === "error" && build.error ? (
            <p className="mono-caption shrink-0 text-fail">{lastLine(build.error)}</p>
          ) : null}
        </div>

        <Rail
          findings={build?.findings ?? []}
          verdict={verdict}
          measurements={project?.measurements ?? []}
          spec={project?.spec ?? null}
          params={{
            params: part?.params ?? [],
            values,
            onChange: onParamsChange,
            onApply: (diff) => void onApply(diff),
            building,
            applying,
            stats,
            error: buildError,
            note,
          }}
          tools={
            part && projectId ? (
              <div className="flex flex-col gap-2.5">
                <Stress
                  key={`stress-${part.id}`}
                  partId={part.id}
                  runId={runId}
                  seed={build?.stress ?? null}
                  values={values}
                />
                <Slice
                  key={`slice-${part.id}`}
                  partId={part.id}
                  projectId={projectId}
                  runId={runId}
                  seed={build?.slice ?? null}
                  onStatus={setSliceStatus}
                />
              </div>
            ) : null
          }
          download={
            part ? (
              <ExportMenu
                key={`export-${part.id}`}
                partId={part.id}
                export={runExport}
                profiles={profiles}
                status={sliceStatus}
                revision={part.revision}
                runId={runId}
              />
            ) : null
          }
          highlight={highlight}
          onHighlight={setHighlight}
        />
      </div>
    </div>
  )
}
