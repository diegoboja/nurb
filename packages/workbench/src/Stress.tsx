import { useEffect, useRef, useState } from "react"
import clsx from "clsx"
import type { Params } from "@nurb/ui"
import { stressPart, type StressResult } from "./api"

// The plastics the solver has numbers for. TPU is missing on purpose: it bends
// instead of breaking, so none of these answers would be true of it.
const MATERIALS = ["PLA", "PETG", "ABS", "ASA", "Nylon"]

const KG_TITLE = "how heavy the thing resting on the part is. 1 kg is about 2 lb, a liter of water"
const RUN_TITLE = "how much weight the part holds before it breaks, pressed where a load usually lands"

// Both units, because the person reading this weighs things in whichever one their
// kitchen scale uses, and a number in the wrong unit is a number skipped. A part the
// weight barely reaches gets no number at all: the margin is not the interesting fact.
function verdict(result: StressResult) {
  const factor = result.factor
  if (factor === null || factor >= 100) return { text: "barely feels this", tone: "text-ink" }
  const said = `${result.holds_kg} kg (${Math.round(result.holds_kg * 2.2046) || 1} lb)`
  if (factor < 1) return { text: `would break: holds about ${said}, not ${result.kg} kg`, tone: "text-fail" }
  if (factor < 2) return { text: `cutting it close: breaks near ${said}`, tone: "text-warn" }
  return { text: `holds up to about ${said}`, tone: "text-ink" }
}

function hover(result: StressResult) {
  const how =
    result.gives === "layers" ? "by splitting at the layer seams" : "through solid plastic"
  return (
    `${result.material}, printed flat the way the plate shows it. peak stress ${result.max_mpa} MPa; ` +
    `${result.across_mpa} MPa of that pulls the layer seams apart, so when it breaks, it breaks ` +
    `${how}. sags ${result.deflection_mm} mm. ` +
    `voxel estimate (about ±30%), ${result.elements} elements at ${result.pitch_mm} mm.`
  )
}

// Will it hold. One weight, one plastic, one sentence back. Mounted per part, so the
// seed is read once and switching parts never inherits someone else's answer.
export default function Stress({
  partId,
  runId,
  seed,
  values,
}: {
  partId: string
  runId: string | null
  seed: StressResult | null
  values: Params
}) {
  const [kg, setKg] = useState(2)
  const [material, setMaterial] = useState(MATERIALS[0])
  const [result, setResult] = useState<StressResult | null>(seed)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [fading, setFading] = useState(false)
  const shownFor = useRef(runId)

  // An answer is about one shape. A rebuild replaces the shape, so the number leaves
  // rather than sitting there describing geometry that is no longer on screen. The
  // fade is a css transition, which the tokens' reduced-motion rule already turns off.
  useEffect(() => {
    if (runId === shownFor.current) return
    shownFor.current = runId
    setError(null)
    if (seed) {
      setResult(seed)
      setStale(false)
      return
    }
    if (!result) return
    setFading(true)
    const timer = setTimeout(() => {
      setResult(null)
      setStale(true)
      setFading(false)
    }, 120)
    return () => clearTimeout(timer)
  }, [runId])

  const run = async () => {
    setRunning(true)
    setError(null)
    setStale(false)
    try {
      const answer = await stressPart(partId, kg, material, values)
      setResult(answer)
      shownFor.current = runId
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The solver did not finish.")
    } finally {
      setRunning(false)
    }
  }

  const answer = result ? verdict(result) : null

  return (
    <div className="flex min-h-[54px] flex-col gap-1" title={result ? hover(result) : undefined}>
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          value={kg}
          min={0.1}
          step={0.5}
          onChange={(e) => setKg(Number(e.target.value))}
          aria-label="Weight in kg"
          title={KG_TITLE}
          className="mono-value w-12 rounded-control border border-line bg-ground px-1.5 py-0.5 text-ink"
        />
        <span className="mono-caption text-muted">kg</span>
        <select
          value={material}
          onChange={(e) => setMaterial(e.target.value)}
          aria-label="Material"
          className="mono-value rounded-control border border-line bg-ground px-1 py-0.5 text-ink"
        >
          {MATERIALS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          title={RUN_TITLE}
          className="mono-label ml-auto rounded-control bg-raised px-2 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:opacity-60"
        >
          stress
        </button>
      </div>

      {/* Always mounted: a live region only announces text that changes inside it. */}
      <p
        role="status"
        className={clsx("text-xs leading-4 transition-opacity duration-[120ms]", fading && "opacity-0")}
      >
        {running ? (
          <span className="mono-caption flex items-center gap-1.5 text-muted">
            <span className="size-1.5 rounded-full bg-accent" />
            solving
          </span>
        ) : error ? (
          <span className="text-fail">{error}</span>
        ) : answer && result ? (
          <span className={answer.tone}>
            {answer.text} <span className="text-muted">· peak {result.max_mpa} MPa</span>
          </span>
        ) : stale ? (
          <span className="text-muted">the shape changed · run stress again</span>
        ) : null}
      </p>
    </div>
  )
}
