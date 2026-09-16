import { StrictMode, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import clsx from "clsx"
import { Icon, AssistantMarkdown, type IconName } from "../src/index"
import { SpecCard, MeasurementCard } from "../src/index"
import { markdownFixture, specFixture, measurementRecorded, measurementChanged } from "./fixtures"
import { BuildCard, ToolStepCard, ToolStepGroup } from "../src/index"
import { buildPassed, buildRunning, buildFailed, groupSteps, stepDone, stepRunning, stepFailed } from "./fixtures"
import { ViewerIsland, type Section as Cut } from "../src/index"
import { ParamsPanel, ExportMenu, type ExportResult, type Params } from "../src/index"
import { panelParams, panelStats } from "./fixtures"
import { flaggedFindings } from "./fixtures"
import Workbench from "./Workbench"
import "./gallery.css"

const ICON_NAMES: IconName[] = [
  "chevron-left", "chevron-down", "chevron-up", "check", "warning", "lock", "plus", "minus",
  "camera", "search", "xmark", "image", "download", "expand", "eye", "arrow-up", "link",
  "stop", "loader", "chat", "dots", "trash", "ruler", "gear", "user", "logout", "box",
]

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-6" data-section={title}>
      <h2 className="mono-label chrome mb-2 text-muted">{title}</h2>
      <div className="panel p-3">{children}</div>
    </section>
  )
}

const STAGE = { height: 400 }

function FindingsViewer() {
  const [highlight, setHighlight] = useState<number | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <div style={STAGE}>
        <ViewerIsland glbUrl="/flagged.glb" findings={flaggedFindings} highlight={highlight} onHighlight={setHighlight} />
      </div>
      <div className="flex flex-col gap-[2px]">
        {flaggedFindings.map((f, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setHighlight(i === highlight ? null : i)}
            className={clsx(
              "flex gap-2 rounded px-2 py-1 text-left text-[12px]",
              i === highlight ? "bg-accent-wash text-ink" : "text-ink-soft"
            )}
          >
            <span className="mono-caption w-[90px] shrink-0 text-faint">{f.label || f.rule}</span>
            <span>{f.message}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function ParamsPanelDemo() {
  const [params, setParams] = useState(panelParams)
  const [values, setValues] = useState<Params>({})
  const [note, setNote] = useState<string | null>(null)
  return (
    <div className="h-[420px] w-[300px] overflow-hidden rounded-content border border-line">
      <ParamsPanel
        params={params}
        values={values}
        onChange={(next) => {
          setValues(next)
          setNote(null)
        }}
        onApply={(edited) => {
          // The host's half of Apply: the edited values become the declared defaults.
          setParams((prior) => prior.map((p) => (p.name in edited ? { ...p, default: edited[p.name] } : p)))
          setValues({})
          setNote(`Saved ${Object.keys(edited).join(", ")} as the part's defaults.`)
        }}
        stats={panelStats}
        note={note}
      />
    </div>
  )
}

// The export takes 1500 ms so the preparing row is visible on the way to the link.
function ExportMenuDemo() {
  const slowExport = (format: string): Promise<ExportResult> =>
    new Promise((resolve) =>
      setTimeout(() => resolve({ url: `/exports/shelf_bracket.${format}`, filename: `shelf_bracket.${format}` }), 1500)
    )
  return (
    <div className="flex h-[240px] w-[254px] items-end">
      <ExportMenu
        partId="shelf-bracket"
        export={slowExport}
        profiles={["Bambu P1S 0.4", "Prusa MK4 0.4"]}
        status={{ state: "succeeded", grams: 42.4, seconds: 5400 }}
        revision={26}
      />
    </div>
  )
}

function SectionViewer() {
  const [cut, setCut] = useState<Cut>({ axis: "z", t: 0.5 })
  return (
    <div className="flex flex-col gap-3">
      <div style={STAGE}>
        <ViewerIsland glbUrl="/flagged.glb" section={cut} />
      </div>
      <div className="flex items-center gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <button
            key={axis}
            type="button"
            onClick={() => setCut((c) => ({ ...c, axis }))}
            className={clsx(
              "mono-caption rounded px-2 py-1",
              axis === cut.axis ? "bg-accent text-white" : "text-ink-soft"
            )}
          >
            {axis}
          </button>
        ))}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={cut.t}
          onChange={(e) => setCut((c) => ({ ...c, t: Number(e.target.value) }))}
          className="flex-1"
        />
        <span className="mono-caption w-[36px] text-faint">{cut.t.toFixed(2)}</span>
      </div>
    </div>
  )
}

function Viewers() {
  return (
    <div className="mx-auto mt-6 w-[640px]">
      <Section title="ViewerIsland">
        <div style={STAGE}>
          <ViewerIsland glbUrl="/shelf_gridfinity.glb" bed={[256, 256]} />
        </div>
      </Section>

      <Section title="ViewerIsland · findings">
        <FindingsViewer />
      </Section>

      <Section title="ViewerIsland · section">
        <SectionViewer />
      </Section>

      <Section title="ViewerIsland · ghost">
        <div style={STAGE}>
          <ViewerIsland glbUrl="/flagged.glb" targetUrl="/flagged.target.glb" />
        </div>
      </Section>
    </div>
  )
}

function Gallery() {
  return (
    <div className="min-h-full bg-stage py-8">
      <div className="mx-auto w-[372px]">
        <h1 className="font-display chrome mb-6 text-[20px] text-ink">@nurb/ui</h1>

        <Section title="Icon">
          <div className="flex flex-wrap gap-x-3 gap-y-3">
            {ICON_NAMES.map((name) => (
              <div key={name} className="flex w-[80px] flex-col items-center gap-1">
                <Icon name={name} className="text-ink-soft" />
                <span className="mono-caption w-full truncate text-center text-faint">{name}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="AssistantMarkdown">
          <div className="text-chat text-ink-soft">
            <AssistantMarkdown content={markdownFixture} />
          </div>
        </Section>

        <Section title="AssistantMarkdown · streaming">
          <div className="text-chat text-ink-soft">
            <AssistantMarkdown content="Building the bracket now" streaming />
          </div>
        </Section>

        <Section title="SpecCard">
          <SpecCard spec={specFixture} model="claude-fable-5" effort="low" />
        </Section>

        <Section title="MeasurementCard">
          <div className="flex flex-col gap-3">
            <MeasurementCard measurement={measurementRecorded} />
            <MeasurementCard
              measurement={measurementChanged}
              staleParts={["bracket", "end_cap"]}
              onAccept={(name) => console.log("accept", name)}
              onEdit={(name) => console.log("edit", name)}
              onRebuild={(parts) => console.log("rebuild", parts)}
            />
          </div>
        </Section>

        <Section title="ParamsPanel">
          <ParamsPanelDemo />
        </Section>

        <Section title="ExportMenu">
          <ExportMenuDemo />
        </Section>

        {/* cards */}

        <Section title="ToolStepCard">
          <div className="flex flex-col gap-[2px]">
            <ToolStepCard step={stepDone} />
            <ToolStepCard step={stepRunning} />
            <ToolStepCard step={stepFailed} />
          </div>
        </Section>

        <Section title="ToolStepGroup">
          <ToolStepGroup steps={groupSteps} />
        </Section>

        <Section title="BuildCard · passed">
          <BuildCard build={buildPassed} />
        </Section>

        <Section title="BuildCard · running">
          <BuildCard build={buildRunning} />
        </Section>

        <Section title="BuildCard · failed">
          <BuildCard build={buildFailed} />
        </Section>
      </div>

      <Viewers />

      <Workbench />
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>
)
