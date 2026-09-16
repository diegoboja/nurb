import Icon from "./Icon"
import { stackLabel } from "./format"
import type { Spec, SpecDimension } from "./types"

// The pinned spec, rendered as a card in the transcript. This is the moment
// intake hands off to the build executor, so it reads like a settled
// contract: what gets built, from which numbers, and where each number came
// from. STANDARD / MEASURED / ASKED / DOCTRINE is the whole point (DESIGN.md §1).

const SOURCE_LABELS: Record<string, string> = {
  standard: "Standard",
  measured: "Measured",
  asked: "Asked",
  doctrine: "Doctrine",
}

// Specs pinned before `source` existed carry only prose provenance; a few
// words in it are reliable enough to pick a label.
function sourceOf(dim: SpecDimension) {
  if (dim.source) return dim.source
  const how = dim.how.toLowerCase()
  if (/\b(caliper|measured|ruler|tape)\b/.test(how)) return "measured"
  if (/\b(user|stated|asked|said|told)\b/.test(how)) return "asked"
  if (/\b(standard|spec|published|listing|datasheet|nominal)\b/.test(how)) return "standard"
  return "doctrine"
}

// A check rule the build reports (min_wall, overhang) is a tag; a measurable
// assertion on bbox or volume is prose and gets a generic tag instead.
function checkTag(check: string) {
  return /^[a-z][a-z0-9_]*$/.test(check.trim()) ? check.trim() : "assert"
}

function Rule({ children }: { children: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="mono-caption shrink-0 text-faint [letter-spacing:0.12em]">{children}</span>
      <span className="h-px flex-1 bg-line-soft" />
    </div>
  )
}

export default function SpecCard({ spec, model, effort }: { spec: Spec; model?: string; effort?: string }) {
  const pinnedBy = stackLabel(model, effort)

  return (
    <div className="flex flex-col overflow-hidden rounded-[6px] border border-line">
      <div className="chrome flex h-[30px] items-center justify-between border-b border-line-soft bg-raised px-3">
        <span className="mono-label flex items-center gap-2 text-ink">
          <Icon name="lock" />
          Spec pinned
        </span>
        <span className="mono-id text-muted">{[pinnedBy, spec.part_name].filter(Boolean).join(" · ")}</span>
      </div>

      <div className="flex flex-col gap-3 px-3 pt-[11px] pb-3">
        <p className="text-[13px] leading-[19px] text-pretty text-ink-soft">{spec.summary}</p>

        <dl className="flex flex-col gap-[5px]">
          {spec.dimensions.map((dim) => {
            const source = sourceOf(dim)
            return (
              <div
                key={dim.name}
                className="flex items-baseline gap-2"
                title={dim.provisional ? `${dim.how} · provisional, a real measurement should replace it` : dim.how}
              >
                <dt className="mono-id min-w-0 flex-1 truncate text-ink-soft">{dim.name}</dt>
                <dd className="mono-value text-ink">
                  {dim.provisional ? "~" : ""}
                  {dim.value_mm} mm
                </dd>
                <dd className={source === "measured" ? "mono-caption w-16 text-right text-accent-ink [letter-spacing:0.1em]" : "mono-caption w-16 text-right text-muted [letter-spacing:0.1em]"}>
                  {SOURCE_LABELS[source]}
                </dd>
              </div>
            )
          })}
        </dl>

        {spec.acceptance.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Rule>Pass if</Rule>
            <ul className="flex flex-col gap-1.5" role="list">
              {spec.acceptance.map((item, index) => (
                <li key={index} className="grid grid-cols-[72px_minmax(0,1fr)] items-baseline gap-x-2" title={item.check}>
                  <span className="mono-id truncate uppercase text-muted [letter-spacing:0.06em]">{checkTag(item.check)}</span>
                  <span className="text-xs leading-4 text-pretty text-ink-soft">{item.criterion}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {spec.params.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Rule>{`${spec.params.length} slider${spec.params.length === 1 ? "" : "s"}`}</Rule>
            <ul className="flex flex-wrap gap-1" role="list">
              {spec.params.map((p) => (
                <li key={p.name} className="mono-id rounded-full bg-raised px-1.5 py-0.5 text-ink-soft" title={p.description}>
                  {p.name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  )
}
