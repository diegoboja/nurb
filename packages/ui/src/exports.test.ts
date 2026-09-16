import { it, expect } from "vitest"
import * as ui from "./index"

// CONTRACT §3's component set, in full. Nothing here is pending.
it.each([
  "Icon",
  "ViewerIsland",
  "ParamsPanel",
  "ExportMenu",
  "BuildCard",
  "SpecCard",
  "MeasurementCard",
  "AssistantMarkdown",
  "ToolStepCard",
  "ToolStepGroup",
])("exports %s as a component", (name) => {
  expect(typeof (ui as Record<string, unknown>)[name]).toBe("function")
})
