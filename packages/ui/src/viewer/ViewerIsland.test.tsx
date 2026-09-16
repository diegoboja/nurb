import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { ViewerIsland } from "./ViewerIsland"
import type { Finding } from "../types"
import { Box3, type Object3D, type Vector3 } from "three"

// jsdom has no WebGL and no GLTF, and its ResizeObserver does not exist at all. Those
// three are mocked; every other piece of three.js is the real thing, because the point
// of these tests is the scene arithmetic.

const gl = vi.hoisted(() => ({ instances: [] as { setSize: (w: number, h: number, u?: boolean) => void }[] }))

vi.mock(import("three"), async (importOriginal) => {
  const actual = await importOriginal()
  class WebGLRenderer {
    domElement: HTMLCanvasElement
    localClippingEnabled = false
    constructor() {
      // The real renderer brings its own canvas, and the component appends it.
      this.domElement = document.createElement("canvas")
      gl.instances.push(this)
    }
    // Mirrors r185: the third argument decides whether the CSS size is written back.
    setSize(w: number, h: number, updateStyle = true) {
      this.domElement.width = w
      this.domElement.height = h
      if (updateStyle !== false) {
        this.domElement.style.width = `${w}px`
        this.domElement.style.height = `${h}px`
      }
    }
    setPixelRatio() {}
    setClearColor() {}
    render() {}
    setAnimationLoop() {}
    clearStencil() {}
    dispose() {}
    forceContextLoss() {}
  }
  return { ...actual, WebGLRenderer: WebGLRenderer as unknown as typeof actual.WebGLRenderer }
})

const loads = vi.hoisted(() => ({ disposed: [] as string[], hold: false }))

vi.mock(import("three/addons/loaders/GLTFLoader.js"), async () => {
  const three = await import("three")
  const SIZES: Record<string, [number, number, number]> = {
    "/a.glb": [40, 30, 20],
    "/b.glb": [40, 30, 20],
    "/big.glb": [400, 300, 200],
    "/ghost.glb": [40, 30, 20],
  }
  class GLTFLoader {
    async loadAsync(url: string) {
      // A held load stays in flight until the test releases it.
      while (loads.hold) await new Promise((r) => setTimeout(r, 1))
      const [x, y, z] = SIZES[url] ?? [10, 10, 10]
      const scene = new three.Group()
      const mesh = new three.Mesh(new three.BoxGeometry(x, y, z))
      mesh.geometry.addEventListener("dispose", () => loads.disposed.push(url))
      scene.add(mesh)
      return { scene }
    }
  }
  return { GLTFLoader } as unknown as typeof import("three/addons/loaders/GLTFLoader.js")
})

const ro = vi.hoisted(() => ({
  calls: 0,
  size: { width: 800, height: 600 },
  fire: [] as (() => void)[],
}))

class ResizeObserverStub {
  private mo: MutationObserver | null = null
  constructor(private cb: (entries: { target: Element; contentRect: { width: number; height: number } }[]) => void) {}
  observe(el: Element) {
    const notify = (width: number, height: number) => {
      ro.calls++
      this.cb([{ target: el, contentRect: { width, height } }])
    }
    ro.fire.push(() => notify(ro.size.width, ro.size.height))
    // A browser re-notifies when an inline size change moves the box. Modeling that is
    // what makes a setSize(w, h) with the default updateStyle show up as a ratchet.
    this.mo = new MutationObserver((records) => {
      const target = records[records.length - 1].target as HTMLElement
      notify(parseFloat(target.style.width) || 0, parseFloat(target.style.height) || 0)
    })
    this.mo.observe(el, { attributes: true, attributeFilter: ["style"], subtree: true })
    notify(ro.size.width, ro.size.height)
  }
  unobserve() {}
  disconnect() {
    this.mo?.disconnect()
  }
}

beforeEach(() => {
  gl.instances.length = 0
  loads.disposed.length = 0
  loads.hold = false
  ro.calls = 0
  ro.fire.length = 0
  ro.size = { width: 800, height: 600 }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// The holder is hung off the container so a test can read the scene it built.
type Holder = {
  camera: {
    updateMatrixWorld: (f?: boolean) => void
    matrixWorld: { elements: number[] }
    position: { set: (x: number, y: number, z: number) => void }
  }
  controls: { dispatchEvent: (e: { type: string }) => void; target: { set: (x: number, y: number, z: number) => void }; update: () => boolean }
  plane: { constant: number }
  part: { getWorldPosition: (v: Vector3) => Vector3; children: Object3D[] } | null
  box: Box3
  glows: { material: { opacity: number }; children: unknown[] }[]
}
const viewer = (container: HTMLElement): Holder =>
  (container.firstElementChild as HTMLElement & { __nurbViewer: Holder }).__nurbViewer

const matrix = (h: Holder) => {
  h.camera.updateMatrixWorld(true)
  return [...h.camera.matrixWorld.elements]
}

const settle = async () => {
  await act(async () => {})
}

it("keeps the camera when a rebuild swaps in the same shape", async () => {
  const view = render(<ViewerIsland glbUrl="/a.glb" bed={[256, 256]} />)
  await settle()
  const h = viewer(view.container)
  // Orbit away from the framed pose first: framing the same shape twice gives the same
  // matrix, so without this the assertion cannot fail.
  act(() => {
    h.camera.position.set(-37.5, 22.25, 41.75)
    h.controls.target.set(3.5, -2.25, 11.75)
    h.controls.update()
  })
  const before = matrix(h)
  view.rerender(<ViewerIsland glbUrl="/b.glb" bed={[256, 256]} />)
  await settle()
  expect(matrix(h)).toEqual(before)
  expect(loads.disposed).toContain("/a.glb")
})

it("reframes when the new shape leaves the camera inside it", async () => {
  const view = render(<ViewerIsland glbUrl="/a.glb" />)
  await settle()
  const h = viewer(view.container)
  const before = matrix(h)
  view.rerender(<ViewerIsland glbUrl="/big.glb" />)
  await settle()
  expect(matrix(h)).not.toEqual(before)
})

it("resizes once per observation and never writes the canvas size back", async () => {
  const view = render(<ViewerIsland glbUrl="/a.glb" />)
  await settle()
  expect(ro.calls).toBe(1)

  ro.size = { width: 600, height: 600 }
  await act(async () => {
    ro.fire.forEach((f) => f())
  })
  expect(ro.calls).toBe(2)
  await settle()
  expect(ro.calls).toBe(2)

  const canvas = view.container.querySelector("canvas") as HTMLCanvasElement
  expect(canvas.width).toBe(600)
  expect(canvas.style.width).toBe("")

  // Negative control: the same call with the default updateStyle is the ratchet, and the
  // harness has to notice it.
  await act(async () => {
    gl.instances[0].setSize(600, 600)
  })
  expect(canvas.style.width).toBe("600px")
  expect(ro.calls).toBeGreaterThan(2)
})

it("reports the camera 250 ms after the last change, and not for its own framing", async () => {
  const onCamera = vi.fn()
  vi.useFakeTimers()
  const view = render(<ViewerIsland glbUrl="/a.glb" onCamera={onCamera} />)
  await act(async () => {
    await vi.runAllTimersAsync()
  })
  expect(onCamera).not.toHaveBeenCalled() // the first frame is the component's move, not the user's
  const h = viewer(view.container)
  act(() => {
    h.controls.dispatchEvent({ type: "change" })
    vi.advanceTimersByTime(100)
    h.controls.dispatchEvent({ type: "change" })
    vi.advanceTimersByTime(260)
  })
  expect(onCamera).toHaveBeenCalledTimes(1)
  const state = onCamera.mock.calls[0][0]
  expect(state.position).toHaveLength(3)
  expect(state.target).toEqual([0, 0, 10])
})

it("parks the clip plane when the section closes", async () => {
  const view = render(<ViewerIsland glbUrl="/a.glb" section={{ axis: "z", t: 0.5 }} />)
  await settle()
  const h = viewer(view.container)
  expect(Number.isFinite(h.plane.constant)).toBe(true)
  expect(Math.abs(h.plane.constant)).toBeLessThan(100)
  view.rerender(<ViewerIsland glbUrl="/a.glb" section={null} />)
  await settle()
  expect(Math.abs(h.plane.constant)).toBe(1e6)
})

const triangle = (z: number) => [0, 0, z, 10, 0, z, 0, 10, z]
const findings: Finding[] = [
  { rule: "overhang", severity: "fail", message: "steep", face: triangle(0), where: [1, 1, 0] },
  { rule: "min_wall", severity: "warn", message: "thin", face: triangle(5), where: [1, 1, 5] },
]

it("draws a glow per finding and emphasizes the highlighted one", async () => {
  const view = render(<ViewerIsland glbUrl="/a.glb" findings={findings} />)
  await settle()
  const h = viewer(view.container)
  expect(h.glows).toHaveLength(2)
  expect(h.glows[1].material.opacity).toBeCloseTo(0.38)

  view.rerender(<ViewerIsland glbUrl="/a.glb" findings={findings} highlight={1} />)
  await settle()
  expect(h.glows[1].material.opacity).toBeCloseTo(0.62)
  expect(h.glows[1].children).toHaveLength(1)
  expect(h.glows[0].children).toHaveLength(0)

  view.rerender(<ViewerIsland glbUrl="/a.glb" findings={[findings[0]]} />)
  await settle()
  expect(h.glows).toHaveLength(1)
})

it("plates a Y-up part on the bed and centers it", async () => {
  const view = render(<ViewerIsland glbUrl="/a.glb" up={[0, 1, 0]} />)
  await settle()
  const h = viewer(view.container)
  const world = new Box3()
  for (const child of h.part!.children) world.expandByObject(child)
  // The 40x30x20 box with Y as print-up stands 30 tall on the bed, centered in X and Y.
  expect(world.min.z).toBeCloseTo(0)
  expect(world.max.z).toBeCloseTo(30)
  expect(world.min.x).toBeCloseTo(-20)
  expect(world.max.x).toBeCloseTo(20)
  expect(world.min.y).toBeCloseTo(-10)
  expect(world.max.y).toBeCloseTo(10)
  expect(h.box.min.z).toBeCloseTo(0)
  expect(h.box.max.z).toBeCloseTo(30)
})

it("holds new findings until the part they describe has loaded", async () => {
  const view = render(<ViewerIsland glbUrl="/a.glb" findings={[findings[0]]} />)
  await settle()
  const h = viewer(view.container)
  expect(h.glows).toHaveLength(1)
  loads.hold = true
  view.rerender(<ViewerIsland glbUrl="/b.glb" findings={findings} />)
  expect(h.glows).toHaveLength(1) // still the old part's marks, not new marks on old geometry
  loads.hold = false
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10)) // the held loader polls a real timer
  })
  expect(h.glows).toHaveLength(2)
})
