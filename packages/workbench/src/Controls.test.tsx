import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import App from "./App"
import { part, project, summaries } from "./fixtures"
import type { Part, Project, StressResult } from "./api"
import { FakeSocket, installSocket } from "./socket-stub"

// The real island needs WebGL; the stage's data attribute is what the tests read.
vi.mock("@nurb/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@nurb/ui")>()
  return { ...actual, ViewerIsland: () => <div data-testid="viewer" /> }
})

interface Call {
  url: string
  method: string
  body: Record<string, unknown> | null
}

let calls: Call[] = []
let state: Project

const base = part("lid", "/glb/p2/lid.glb?run=1")

function withPart(over: Partial<Part>): Project {
  return project("p2", "Second", [{ ...base, ...over }])
}

function sent(tail: string) {
  return calls.filter((c) => c.url.endsWith(tail) && c.method === "POST")
}

function install(routes: Record<string, (body: Record<string, unknown> | null) => unknown> = {}) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null
    calls.push({ url, method, body })
    if (url === "/api/projects") return new Response(JSON.stringify({ projects: summaries }))
    if (url === "/api/projects/p2" && method === "GET") return new Response(JSON.stringify(state))
    const handler = routes[`${method} ${url}`]
    if (!handler) return new Response("nothing here", { status: 404 })
    const answer = handler(body)
    return answer instanceof Response ? answer : new Response(JSON.stringify(answer))
  })
}

beforeEach(() => {
  calls = []
  state = withPart({})
  installSocket()
  URL.createObjectURL = vi.fn(() => "blob:lid") as never
  URL.revokeObjectURL = vi.fn() as never
  history.replaceState(null, "", "/?project=p2&part=lid")
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("sliders", () => {
  it("posts the whole value map once, after the debounce", async () => {
    state = withPart({
      params: [
        { name: "wall", kind: "float", default: 2 },
        { name: "ribs", kind: "int", default: 4 },
      ],
      overrides: { ribs: 6 },
    })
    install({ "POST /api/parts/part-lid/params": () => ({ build: base.build }) })
    render(<App />)

    // The panel opens on the declared defaults and takes the run's overrides a
    // moment later; a drag before that would be measuring the wrong start.
    await waitFor(() => expect(screen.getByLabelText("ribs value")).toHaveValue("6"))
    const wall = screen.getByLabelText("wall")
    vi.useFakeTimers()
    fireEvent.change(wall, { target: { value: "3" } })
    act(() => void vi.advanceTimersByTime(100))
    expect(sent("/params")).toHaveLength(0)

    act(() => void vi.advanceTimersByTime(200))
    vi.useRealTimers()
    await waitFor(() => expect(sent("/params")).toHaveLength(1))
    expect(sent("/params")[0].body).toEqual({ values: { ribs: 6, wall: 3 } })
  })

  it("drops a queued rebuild when the view goes away", async () => {
    install({ "POST /api/parts/part-lid/params": () => ({ build: base.build }) })
    const view = render(<App />)

    const wall = await screen.findByLabelText("wall")
    vi.useFakeTimers()
    fireEvent.change(wall, { target: { value: "3" } })
    act(() => void vi.advanceTimersByTime(100))
    view.unmount()
    act(() => void vi.advanceTimersByTime(400))
    vi.useRealTimers()

    expect(sent("/params")).toHaveLength(0)
  })

  it("shows the server's sentence when a rebuild is refused, and keeps the sliders", async () => {
    install({
      "POST /api/parts/part-lid/params": () =>
        new Response(JSON.stringify({ error: "build lid once before changing its parameters" }), {
          status: 400,
        }),
    })
    render(<App />)

    const wall = await screen.findByLabelText("wall")
    vi.useFakeTimers()
    fireEvent.change(wall, { target: { value: "3" } })
    act(() => void vi.advanceTimersByTime(300))
    vi.useRealTimers()

    expect(await screen.findByText("build lid once before changing its parameters")).toBeInTheDocument()
    expect(screen.getByLabelText("wall")).toBeInTheDocument()
  })

  it("swaps the stage geometry when the rebuild lands", async () => {
    install()
    render(<App />)
    await waitFor(() =>
      expect(screen.getByTestId("stage")).toHaveAttribute("data-glb-url", "/glb/p2/lid.glb?run=1")
    )

    state = withPart({ build: { ...base.build!, id: "b2", glb_url: "/glb/p2/lid.glb?run=b2" } })
    FakeSocket.instances[0].emit({ kind: "build", id: "b2", project_id: "p2" })
    await waitFor(() =>
      expect(screen.getByTestId("stage")).toHaveAttribute("data-glb-url", "/glb/p2/lid.glb?run=b2")
    )
  })
})

describe("first build", () => {
  it("builds a part that has never built, from the stage", async () => {
    state = withPart({ build: null, params: [] })
    install({ "POST /api/parts/part-lid/params": () => ({ build: base.build }) })
    render(<App />)

    await userEvent.click(await screen.findByRole("button", { name: "Build lid" }))
    await waitFor(() => expect(sent("/params")).toHaveLength(1))
    expect(sent("/params")[0].body).toEqual({ values: {} })
  })
})

describe("apply", () => {
  it("sends only what moved and names the revision it saved", async () => {
    state = withPart({ overrides: { wall: 3 } })
    install({
      "POST /api/parts/part-lid/apply": () => ({
        revision_id: "r2",
        revision: 4,
        written: ["wall"],
        skipped: [],
        build: base.build,
      }),
    })
    render(<App />)

    await userEvent.click(await screen.findByRole("button", { name: "Apply" }))
    await waitFor(() => expect(sent("/apply")).toHaveLength(1))
    expect(sent("/apply")[0].body).toEqual({ values: { wall: 3 } })
    expect(await screen.findByText("Saved as rev 4. wall 2 → 3")).toBeInTheDocument()
  })
})

describe("stress", () => {
  const answer: StressResult = {
    kg: 2,
    material: "PLA",
    max_mpa: 8.1,
    across_mpa: 3.2,
    deflection_mm: 0.4,
    elements: 12000,
    pitch_mm: 1.2,
    holds_kg: 12,
    factor: 6,
    gives: "layers",
    glb_hash: "h1",
    run_id: "b1",
  }

  it("drops the answer when the shape changes under it", async () => {
    state = withPart({ build: { ...base.build!, stress: answer } })
    install()
    render(<App />)
    expect(await screen.findByText(/holds up to about 12 kg \(26 lb\)/)).toBeInTheDocument()

    state = withPart({ build: { ...base.build!, id: "b2", glb_url: "/glb/p2/lid.glb?run=b2" } })
    FakeSocket.instances[0].emit({ kind: "build", id: "b2", project_id: "p2" })

    await waitFor(() =>
      expect(screen.getByText("the shape changed · run stress again")).toBeInTheDocument()
    )
    expect(screen.queryByText(/holds up to about/)).toBeNull()
  })
})

describe("print time", () => {
  it("asks which printer, then names one and slices again", async () => {
    state = withPart({
      build: { ...base.build!, slice: { kind: "choose", profiles: ["bambu_x1c", "prusa_mk4"] } },
    })
    install({
      "POST /api/projects/p2/printer": () => ({ printer: { name: "prusa_mk4", bed: [250, 210, 220] } }),
    })
    render(<App />)

    expect(await screen.findByText("which printer is this for?")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "choose your printer…" }))
    await userEvent.click(screen.getByRole("button", { name: "prusa mk4" }))

    await waitFor(() => expect(sent("/printer")).toHaveLength(1))
    expect(sent("/printer")[0].body).toEqual({ profile: "prusa_mk4" })
    expect(sent("/api/parts/part-lid/slice")).toHaveLength(1)
  })
})

describe("download", () => {
  it("hands the user a link to the file it just built", async () => {
    install({ "POST /api/parts/part-lid/export": () => new Response("3mf bytes") })
    render(<App />)

    await userEvent.click(await screen.findByRole("button", { name: /Download/ }))
    await userEvent.click(screen.getByRole("menuitem", { name: /3mf/i }))

    const link = await screen.findByRole("link", { name: /lid.3mf/ })
    expect(link).toHaveAttribute("href", "blob:lid")
    expect(sent("/export")[0].body).toEqual({ format: "3mf", values: {} })
  })

  it("keeps the menu open when a rebuild lands under it, and drops the stale file", async () => {
    install({ "POST /api/parts/part-lid/export": () => new Response("3mf bytes") })
    render(<App />)

    await userEvent.click(await screen.findByRole("button", { name: /Download/ }))
    await userEvent.click(screen.getByRole("menuitem", { name: /3mf/i }))
    await screen.findByRole("link", { name: /lid.3mf/ })

    state = withPart({ build: { ...base.build!, id: "b2", glb_url: "/glb/p2/lid.glb?run=b2" } })
    FakeSocket.instances[0].emit({ kind: "build", id: "b2", project_id: "p2" })

    // The file described the old shape, so it goes; the menu was the user's, so it stays.
    await waitFor(() => expect(screen.queryByRole("link", { name: /lid.3mf/ })).toBeNull())
    expect(screen.getByRole("menuitem", { name: /3mf/i })).toBeInTheDocument()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:lid")
  })
})
