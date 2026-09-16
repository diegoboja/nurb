import { useEffect, useRef, useState } from "react"
import type { ExportStatus } from "@nurb/ui"
import { setPrinter, slicePart, type SliceResult } from "./api"

// A profile name is a filename; a machine is a thing on a bench.
const spaced = (name: string) => name.replace(/_/g, " ")

// What the plate costs, from the slicer the user already has. It is the one fact about
// a part that the geometry cannot answer, so it is asked for rather than measured on
// every rebuild: a slice is seconds of a real slicer.
export default function Slice({
  partId,
  projectId,
  runId,
  seed,
  onStatus,
}: {
  partId: string
  projectId: string
  runId: string | null
  seed: SliceResult | null
  onStatus: (status: ExportStatus | null) => void
}) {
  const [result, setResult] = useState<SliceResult | null>(seed)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [picking, setPicking] = useState(false)
  const shownFor = useRef(runId)

  useEffect(() => {
    if (runId === shownFor.current) return
    shownFor.current = runId
    setError(null)
    setPicking(false)
    if (seed) {
      setResult(seed)
      setStale(false)
      return
    }
    if (!result) return
    setResult(null)
    setStale(true)
  }, [runId])

  // The download menu's estimate line is this tile's answer, seen from the other side.
  // An unchosen printer and a missing slicer are not failures, so they say nothing there.
  useEffect(() => {
    if (running) {
      onStatus({ state: "queued" })
    } else if (error) {
      onStatus({ state: "failed", error })
    } else if (result?.kind === "slice") {
      onStatus({ state: "succeeded", grams: result.grams, seconds: result.seconds })
    } else if (result && result.kind !== "choose" && result.kind !== "slicer") {
      onStatus({ state: "failed", error: result.error ?? "the slicer did not answer" })
    } else {
      onStatus(null)
    }
  }, [running, error, result, onStatus])

  const ask = async () => {
    setRunning(true)
    setError(null)
    setStale(false)
    setPicking(false)
    try {
      const said = await slicePart(partId)
      setResult(said)
      shownFor.current = runId
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The slicer did not answer.")
    } finally {
      setRunning(false)
    }
  }

  const pick = async (profile: string) => {
    setPicking(false)
    try {
      await setPrinter(projectId, profile)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "That printer did not stick.")
      return
    }
    await ask()
  }

  const kind = running ? null : result?.kind
  const choosing = kind === "choose"
  // A fault that names other machines carries the picker, because picking a different
  // one is what would fix it.
  const profiles = running ? [] : (result?.profiles ?? [])
  const showAsk = !running && !profiles.length && kind !== "slice" && kind !== "slicer"

  return (
    <div className="flex min-h-[54px] flex-col gap-1">
      {/* Always mounted: a live region only announces text that changes inside it. */}
      <div role="status" className="text-xs leading-4">
        {running ? (
          <span className="mono-caption flex items-center gap-1.5 text-muted">
            <span className="size-1.5 rounded-full bg-accent" />
            slicing
          </span>
        ) : error ? (
          <span className="text-fail">{error}</span>
        ) : kind === "slice" && result ? (
          <span className="flex items-baseline gap-2" title={result.settings}>
            <span className="mono-value text-ink">{result.spoken}</span>
            <span className="mono-caption text-muted">
              {result.grams ? `${result.weight} of filament` : "filament unknown"}
            </span>
            <span className="mono-caption ml-auto shrink-0 text-faint">{spaced(result.profile ?? "")}</span>
          </span>
        ) : choosing ? (
          <span className="mono-caption text-muted">which printer is this for?</span>
        ) : kind === "slicer" ? (
          <span className="flex flex-col">
            <span className="mono-caption text-muted">no slicer found</span>
            <span className="text-muted">the 3mf download still works, for whatever you do slice with</span>
          </span>
        ) : result ? (
          <span className="text-fail">{result.error}</span>
        ) : stale ? (
          <span className="text-muted">the shape changed · price it again</span>
        ) : null}
      </div>

      {profiles.length > 0 ? (
        <div className="relative flex">
          <button
            type="button"
            onClick={() => setPicking((v) => !v)}
            aria-expanded={picking}
            className="mono-label rounded-control bg-raised px-2 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            choose your printer…
          </button>
          {picking ? (
            <div className="absolute bottom-full left-0 z-10 mb-1 flex max-h-56 w-[200px] flex-col overflow-y-auto rounded-content border border-panel-edge bg-ground py-1 shadow-[var(--shadow-panel)]">
              {profiles.map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => void pick(name)}
                  className="mono-value px-3 py-1.5 text-left text-ink transition-colors hover:bg-raised focus-visible:bg-raised focus-visible:outline-none"
                >
                  {spaced(name)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : showAsk ? (
        <div className="flex">
          <button
            type="button"
            onClick={() => void ask()}
            title="what this plate costs in time and filament, from the slicer on this machine"
            className="mono-label rounded-control bg-raised px-2 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
          >
            print time
          </button>
        </div>
      ) : null}
    </div>
  )
}
