import { useId, useMemo, useRef, useState } from "react"
import clsx from "clsx"
import Icon from "../Icon"
import type { BuildStats, Param, Params } from "../types"
import { adjustable, decimals, dirtyValues, sliderRange, tidy } from "./paramsState"

export interface ParamsPanelProps {
  params: Param[]
  /** Session values keyed by parameter name; anything missing reads its default. */
  values: Params
  onChange: (values: Params) => void
  /** The edited values only, keyed by name. An untouched panel never gets here. */
  onApply: (values: Params) => void
  /** A rebuild is in flight for these values. */
  building?: boolean
  /** Apply is writing the values into the part's defaults. */
  applying?: boolean
  /** The last build's numbers, for the footer line. */
  stats?: BuildStats | null
  /** A build that failed at these values; the panel keeps showing the controls. */
  error?: string | null
  /** What Apply said, once it landed. */
  note?: string | null
}

function formatValue(value: number, int: boolean, step: number): string {
  return int ? String(Math.round(value)) : String(tidy(value, step))
}

// A python identifier as a rail label: shelf_width -> shelf width.
function label(name: string) {
  return name.replace(/_/g, " ")
}

// A param may annotate its own range; otherwise it is guessed from the default.
function rangeFor(param: Param, int: boolean) {
  const guess = sliderRange(param.default as number, int)
  return {
    lo: param.min ?? guess.lo,
    hi: param.max ?? guess.hi,
    step: param.step ?? guess.step,
  }
}

function SectionRule({ children }: { children: string }) {
  return (
    <div className="chrome flex items-center gap-2 px-4 pt-[11px] pb-2">
      <span className="mono-caption text-faint [letter-spacing:0.12em]">{children}</span>
      <span className="h-px flex-1 bg-line-soft" />
    </div>
  )
}

// The dirty mark doubles as the way back: one click returns the declared default.
function ResetDot({ param, onReset }: { param: Param; onReset: () => void }) {
  return (
    <button
      type="button"
      title={`Default ${param.default}`}
      onClick={onReset}
      aria-label={`Reset ${param.name} to default`}
      className="size-1.5 shrink-0 rounded-full bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    />
  )
}

// Label and value on one baseline, the slider beneath. The value is still a
// field: click it to type an exact number.
function NumberRow({
  id,
  param,
  value,
  dirty,
  onValue,
}: {
  id: string
  param: Param
  value: number
  dirty: boolean
  onValue: (value: number) => void
}) {
  const int = param.kind === "int"
  const range = rangeFor(param, int)
  const lo = Math.min(range.lo, value)
  const hi = Math.max(range.hi, value)
  // A typed 9.25 must stay on the grid too, or the thumb parks beside the fill.
  const step = int ? 1 : Math.min(range.step, 10 ** -decimals(value))
  const [text, setText] = useState(() => formatValue(value, int, step))
  const editing = useRef(false)
  if (!editing.current) {
    const shown = formatValue(value, int, step)
    if (shown !== text) setText(shown)
  }

  const commitText = () => {
    editing.current = false
    const parsed = Number(text)
    if (text.trim() === "" || !Number.isFinite(parsed)) {
      setText(formatValue(value, int, step))
      return
    }
    onValue(int ? Math.round(parsed) : parsed)
  }

  return (
    <div className="flex flex-col gap-1 px-4">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <label
            htmlFor={id}
            title={param.description}
            className={clsx("mono-caption min-w-0 truncate", dirty ? "font-medium text-ink" : "text-muted")}
          >
            {label(param.name)}
          </label>
          {dirty ? <ResetDot param={param} onReset={() => onValue(param.default as number)} /> : null}
        </div>
        <input
          value={text}
          onChange={(e) => {
            editing.current = true
            setText(e.target.value)
          }}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitText()
            if (e.key === "Escape") {
              editing.current = false
              setText(formatValue(value, int, step))
            }
          }}
          inputMode={int ? "numeric" : "decimal"}
          aria-label={`${param.name} value`}
          className={clsx(
            "mono-value w-16 rounded-control border-0 bg-transparent p-0 text-right focus:bg-raised focus:outline-1 focus:outline-accent",
            dirty ? "text-accent-ink" : "text-ink"
          )}
        />
      </div>
      <input
        id={id}
        type="range"
        min={lo}
        max={hi}
        step={step}
        value={value}
        onChange={(e) => onValue(int ? Math.round(Number(e.target.value)) : tidy(Number(e.target.value), step))}
        aria-label={label(param.name)}
        aria-valuetext={`${value}`}
        className="w-full accent-accent"
      />
    </div>
  )
}

function BoolRow({
  id,
  param,
  value,
  dirty,
  onValue,
}: {
  id: string
  param: Param
  value: boolean
  dirty: boolean
  onValue: (value: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2 px-4 py-1">
      <label
        htmlFor={id}
        title={param.description}
        className={clsx("mono-caption min-w-0 truncate", dirty ? "font-medium text-ink" : "text-muted")}
      >
        {label(param.name)}
      </label>
      {dirty ? <ResetDot param={param} onReset={() => onValue(param.default as boolean)} /> : null}
      <span className="flex-1" />
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={label(param.name)}
        onClick={() => onValue(!value)}
        className={clsx(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
          value ? "bg-accent" : "bg-line"
        )}
      >
        <span
          className={clsx(
            "absolute top-0.5 size-3 rounded-full bg-ground transition-[left]",
            value ? "left-3.5" : "left-0.5"
          )}
        />
      </button>
    </div>
  )
}

// Live parameter controls. Every change hands the host the whole value map, so
// the host owns the rebuild; Apply hands it only the values that moved, which
// is what gets written into the part's keyword defaults.
export default function ParamsPanel({
  params,
  values,
  onChange,
  onApply,
  building,
  applying,
  stats,
  error,
  note,
}: ParamsPanelProps) {
  const rows = useMemo(() => params.filter(adjustable), [params])
  const pinned = useMemo(() => params.filter((p) => !adjustable(p)), [params])
  const bools = rows.filter((p) => p.kind === "bool")
  const numbers = rows.filter((p) => p.kind !== "bool")
  const dirty = useMemo(() => dirtyValues(params, values), [params, values])
  const dirtyCount = Object.keys(dirty).length
  // Two panels on one page (a compare view) must not share control ids.
  const prefix = useId()

  const setValue = (name: string, value: number | boolean) => {
    onChange({ ...values, [name]: value })
  }

  if (rows.length === 0) return null

  return (
    <div className="flex min-h-0 flex-1 flex-col" role="group" aria-label="Part parameters">
      {error ? (
        <div className="border-b border-line-soft bg-fail-wash px-4 py-2.5">
          <p className="mono-label flex items-center gap-2 text-fail">
            <Icon name="warning" />
            Build failed at these values
          </p>
          <p className="mt-1 text-xs leading-4 text-ink-soft">{error}</p>
          <p className="mt-0.5 text-xs leading-4 text-muted">Showing the last part that built.</p>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3">
        {pinned.length > 0 ? (
          <>
            <SectionRule>Pinned by spec</SectionRule>
            <dl className="flex flex-col">
              {pinned.map((param) => (
                <div key={param.name} className="flex items-center gap-[9px] px-4 py-1.5" title={param.description}>
                  <span className="text-muted">
                    <Icon name="lock" />
                  </span>
                  <dt className="mono-id min-w-0 flex-1 truncate uppercase text-muted [letter-spacing:0.06em]">
                    {label(param.name)}
                  </dt>
                  <dd className="mono-value text-muted">{String(values[param.name] ?? param.default)}</dd>
                </div>
              ))}
            </dl>
          </>
        ) : null}

        <SectionRule>Yours to drag</SectionRule>
        <div className="flex flex-col gap-3">
          {bools.map((param) => (
            <BoolRow
              key={param.name}
              id={`${prefix}${param.name}`}
              param={param}
              value={(values[param.name] ?? param.default) as boolean}
              dirty={param.name in dirty}
              onValue={(v) => setValue(param.name, v)}
            />
          ))}
          {numbers.map((param) => (
            <NumberRow
              key={param.name}
              id={`${prefix}${param.name}`}
              param={param}
              value={(values[param.name] ?? param.default) as number}
              dirty={param.name in dirty}
              onValue={(v) => setValue(param.name, v)}
            />
          ))}
        </div>
      </div>

      {stats?.size_mm ? (
        <div className="chrome shrink-0 border-t border-line-soft px-4 py-2">
          <span className="mono-caption text-muted">
            {stats.size_mm.map((n) => Math.round(n * 10) / 10).join(" × ")} mm
            {building ? " · rebuilding" : null}
          </span>
        </div>
      ) : null}

      {/* Always mounted: a live region only announces text that changes inside it. */}
      <p
        role="status"
        className={note ? "mx-4 mb-3 rounded-content bg-raised px-3 py-2 text-xs leading-4 text-ink-soft" : "sr-only"}
      >
        {note}
      </p>

      {dirtyCount > 0 ? (
        <div className="chrome mx-4 mb-3 flex h-9 shrink-0 items-center gap-2 rounded-content bg-accent-wash px-3">
          <span className="size-1.5 shrink-0 rounded-full bg-accent" />
          <span className="mono-id flex-1 uppercase text-accent-ink tabular-nums [letter-spacing:0.08em]">
            {dirtyCount} {dirtyCount === 1 ? "change" : "changes"}
          </span>
          <button
            type="button"
            onClick={() => onChange({})}
            className="mono-label rounded-control px-2 py-1 text-ink-soft transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
          >
            Reset
          </button>
          <button
            type="button"
            onClick={() => onApply(dirty)}
            disabled={applying}
            title="Save these values as the part's defaults."
            className="mono-label rounded-control bg-ink px-2.5 py-1.5 text-white transition-colors hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {applying ? "Applying…" : "Apply"}
          </button>
        </div>
      ) : null}
    </div>
  )
}
