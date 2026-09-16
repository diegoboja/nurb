import type { ReactNode } from "react"
import { ParamsPanel, SpecCard, type Finding, type ParamsPanelProps, type Spec } from "@nurb/ui"
import Findings from "./Findings"
import type { ProjectMeasurement } from "./api"
import type { Verdict } from "./verdict"

function Heading({ children }: { children: string }) {
  return <h3 className="mono-label chrome text-muted">{children}</h3>
}

export default function Rail({
  findings,
  verdict,
  measurements,
  spec,
  params,
  tools,
  download,
  highlight,
  onHighlight,
}: {
  findings: Finding[]
  verdict: Verdict
  measurements: ProjectMeasurement[]
  spec: Spec | null
  params: ParamsPanelProps
  /** Stress and print time: the two questions about the part that need a press. */
  tools: ReactNode
  download: ReactNode
  highlight: number | null
  onHighlight: (index: number | null) => void
}) {
  return (
    <div className="panel flex w-[288px] shrink-0 flex-col overflow-hidden max-lg:w-full">
      {/* Measurements and spec are reference, so they are capped and scroll inside;
          the parameters below them are what the rail is for. */}
      <div className="flex max-h-[28%] min-h-0 flex-col gap-5 overflow-y-auto px-4 pt-3.5 pb-4">
        <section className="flex flex-col gap-2">
          <Heading>Measurements</Heading>
          {measurements.length === 0 ? (
            <p className="mono-caption text-muted">Nothing measured yet</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {measurements.map((m) => (
                <li key={m.name} className="flex flex-col gap-0.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="mono-id text-ink-soft">{m.name}</span>
                    <span className="mono-value text-ink">
                      {m.value_mm} {m.unit || "mm"}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="text-xs leading-4 text-muted">{m.how}</span>
                    {m.provisional ? <span className="mono-caption text-warn">provisional</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex flex-col gap-2">
          <Heading>Spec</Heading>
          {spec ? <SpecCard spec={spec} /> : <p className="mono-caption text-muted">No spec pinned</p>}
        </section>
      </div>

      {/* The panel scrolls itself, so it is a flex sibling of the body above, never a
          section inside it. */}
      <ParamsPanel {...params} />

      <div className="flex shrink-0 flex-col gap-3 border-t border-line bg-ground px-4 pt-3.5 pb-4">
        {tools}
        {/* Findings grow with the part, and the footer is pinned, so the list scrolls
            rather than pushing the parameters out of the rail. */}
        <div className="flex max-h-36 min-h-0 flex-col gap-2 overflow-y-auto">
          <Heading>Findings</Heading>
          <Findings findings={findings} verdict={verdict} highlight={highlight} onHighlight={onHighlight} />
        </div>
        <div className="flex gap-2">{download}</div>
      </div>
    </div>
  )
}
