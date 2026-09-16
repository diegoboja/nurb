import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import ParamsPanel from "./ParamsPanel"
import type { Param, Params } from "../types"

const params: Param[] = [
  { name: "width", kind: "float", default: 40.0, description: "outside width" },
  { name: "bracket_count", kind: "int", default: 4 },
  { name: "draft", kind: "bool", default: false },
  { name: "finish", kind: "str", default: "matte" },
]

// The host owns the values, so the panel only reads them back through props.
function Host({ onApply }: { onApply: (values: Params) => void }) {
  const [values, setValues] = useState<Params>({})
  return <ParamsPanel params={params} values={values} onChange={setValues} onApply={onApply} />
}

describe("ParamsPanel", () => {
  // vitest runs with globals off, so Testing Library never registers its own cleanup.
  afterEach(cleanup)

  it("keeps control ids unique across two panels on one page", () => {
    render(
      <>
        <ParamsPanel params={params} values={{}} onChange={vi.fn()} onApply={vi.fn()} />
        <ParamsPanel params={params} values={{}} onChange={vi.fn()} onApply={vi.fn()} />
      </>
    )
    const ids = Array.from(document.querySelectorAll("[id]")).map((el) => el.id)
    expect(new Set(ids).size).toBe(ids.length)
    // Each label still reaches its own control, not the first one in the document.
    const sliders = screen.getAllByRole("slider", { name: "width" })
    expect(sliders).toHaveLength(2)
    const labels = screen.getAllByText("width")
    expect(labels.map((l) => (l as HTMLLabelElement).htmlFor)).toEqual(sliders.map((s) => s.id))
  })

  it("gives a dirty bool the same reset dot as a number, and announces the note", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<ParamsPanel params={params} values={{ draft: true }} onChange={onChange} onApply={vi.fn()} note="Saved draft." />)
    expect(screen.getByRole("status")).toHaveTextContent("Saved draft.")
    await user.click(screen.getByRole("button", { name: "Reset draft to default" }))
    expect(onChange).toHaveBeenCalledWith({ draft: false })
  })

  it("gives every adjustable param a control and pins the rest", () => {
    render(<ParamsPanel params={params} values={{}} onChange={vi.fn()} onApply={vi.fn()} />)
    expect(screen.getByLabelText("width value")).toHaveValue("40")
    expect(screen.getByLabelText("bracket_count value")).toHaveValue("4")
    expect(screen.getByRole("switch", { name: "draft" })).toHaveAttribute("aria-checked", "false")
    expect(screen.getByText("Pinned by spec")).toBeInTheDocument()
    expect(screen.queryByLabelText("finish value")).toBeNull()
  })

  it("calls onApply with the edited values when Apply is clicked", async () => {
    const onApply = vi.fn()
    render(<Host onApply={onApply} />)

    const field = screen.getByLabelText("width value")
    await userEvent.clear(field)
    await userEvent.type(field, "55")
    await userEvent.tab()

    await userEvent.click(screen.getByRole("switch", { name: "draft" }))

    expect(screen.getByText("2 changes")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(onApply).toHaveBeenCalledWith({ width: 55, draft: true })
  })

  it("commits a typed value when the field loses focus, and reverts it on Escape", () => {
    const onChange = vi.fn()
    render(<ParamsPanel params={params} values={{}} onChange={onChange} onApply={vi.fn()} />)
    const field = screen.getByLabelText("width value")

    // Clicking away is as much a commit as pressing Enter; the typed number is
    // what the user meant either way.
    fireEvent.change(field, { target: { value: "9" } })
    fireEvent.blur(field)
    expect(onChange).toHaveBeenCalledWith({ width: 9 })

    onChange.mockClear()
    fireEvent.change(field, { target: { value: "12" } })
    fireEvent.keyDown(field, { key: "Escape" })
    expect(onChange).not.toHaveBeenCalled()
    expect(field).toHaveValue("40")
  })

  it("hides the change strip until a value moves off its default", async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <ParamsPanel params={params} values={{ width: 40 }} onChange={onChange} onApply={vi.fn()} />
    )
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull()

    rerender(<ParamsPanel params={params} values={{ width: 52 }} onChange={onChange} onApply={vi.fn()} />)
    expect(screen.getByText("1 change")).toBeInTheDocument()
  })

  it("resets every value with the Reset button", async () => {
    const onChange = vi.fn()
    render(<ParamsPanel params={params} values={{ width: 52 }} onChange={onChange} onApply={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "Reset" }))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it("moves a slider in whole steps for an int and tidied steps for a float", async () => {
    const onChange = vi.fn()
    render(<ParamsPanel params={params} values={{}} onChange={onChange} onApply={vi.fn()} />)
    expect(screen.getByRole("slider", { name: "bracket count" })).toHaveAttribute("step", "1")
    expect(screen.getByRole("slider", { name: "width" })).toHaveAttribute("step", "1")
  })

  it("keeps showing the controls when a build failed at these values", () => {
    render(
      <ParamsPanel
        params={params}
        values={{ width: 52 }}
        onChange={vi.fn()}
        onApply={vi.fn()}
        error="BRep_API: command not done"
      />
    )
    expect(screen.getByText("Build failed at these values")).toBeInTheDocument()
    expect(screen.getByLabelText("width value")).toHaveValue("52")
  })

  it("renders nothing when no param is adjustable", () => {
    const { container } = render(
      <ParamsPanel params={[params[3]]} values={{}} onChange={vi.fn()} onApply={vi.fn()} />
    )
    expect(container).toBeEmptyDOMElement()
  })
})
