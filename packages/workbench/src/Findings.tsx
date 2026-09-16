import { useMemo, useState } from "react"
import clsx from "clsx"
import { Icon, type Finding } from "@nurb/ui"
import type { Verdict } from "./verdict"

function severityText(severity: string) {
  return severity === "fail" ? "text-fail" : "text-warn"
}

// The rail's list, and the other end of the viewer's highlight.
export default function Findings({
  findings,
  verdict,
  highlight,
  onHighlight,
}: {
  findings: Finding[]
  verdict: Verdict
  highlight: number | null
  onHighlight: (index: number | null) => void
}) {
  const counts = useMemo(() => {
    const fail = findings.filter((f) => f.severity === "fail").length
    return { fail, warn: findings.length - fail }
  }, [findings])
  const [open, setOpen] = useState(true)

  if (findings.length === 0) {
    // An empty list is not a pass: a part that never built, and one whose build
    // broke, both arrive here with nothing to list.
    const empty =
      verdict === "none"
        ? "Nothing checked yet"
        : verdict === "fail"
          ? "The build stopped before the checks ran"
          : "Nothing to fix. Checks pass at these numbers."
    return <p className="mono-caption py-1 text-center text-muted">{empty}</p>
  }

  const worst = counts.fail > 0 ? "fail" : "warn"
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="chrome flex items-center justify-between gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        <span className="flex items-center gap-2">
          <span className={severityText(worst)}>
            <Icon name={counts.fail > 0 ? "xmark" : "warning"} />
          </span>
          <span className="mono-id uppercase text-ink-soft [letter-spacing:0.08em]">
            {counts.fail} fail · {counts.warn} warn
          </span>
        </span>
        <span className={clsx("text-muted", !open && "-rotate-90")}>
          <Icon name="chevron-down" />
        </span>
      </button>

      {open ? (
        <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
          {findings.map((f, i) => (
            <li key={i}>
              <button
                type="button"
                aria-pressed={i === highlight}
                onClick={() => onHighlight(i === highlight ? null : i)}
                className={clsx(
                  "flex w-full items-baseline gap-2 rounded-control px-2 py-1 text-left transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                  i === highlight ? "bg-accent-wash" : "hover:bg-raised"
                )}
              >
                <span className={clsx("mono-id shrink-0 uppercase [letter-spacing:0.06em]", severityText(f.severity))}>
                  {f.label || f.rule}
                </span>
                <span className="text-xs leading-4 text-muted">{f.message}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
