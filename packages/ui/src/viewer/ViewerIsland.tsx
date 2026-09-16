import { useEffect, useRef, type JSX } from "react"
import clsx from "clsx"
import {
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three"
import type { BufferGeometry, Material, Object3D } from "three"
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import type { Finding } from "../types"
import {
  HIGHLIGHT_OPACITY,
  buildPartGroup,
  cameraSeesBox,
  capMesh,
  createLights,
  disposeGroup,
  frameCamera,
  glowMesh,
  glowOutline,
  palette,
  pinMesh,
  plate,
  plateGroup,
  printedBox,
  saneCamera,
  stencilWriters,
} from "./scene"

export type Vec3 = [number, number, number]

export interface CameraState {
  position: Vec3
  target: Vec3
}

export interface Section {
  axis: "x" | "y" | "z"
  /** 0..1 along the axis; dragging right keeps more material */
  t: number
}

export interface ViewerIslandProps {
  /** The part's GLB. Changing it swaps the geometry and keeps the camera. null clears the part. */
  glbUrl: string | null
  /** A reference mesh drawn as a translucent ghost, offset by `targetOffset`. */
  targetUrl?: string | null
  targetOffset?: Vec3
  findings?: Finding[]
  /** Index into `findings` of the one to emphasize. */
  highlight?: number | null
  /** Called when the user clicks a finding's glow (index) or empty space (null). */
  onHighlight?: (index: number | null) => void
  /** Printer bed [width, depth] in mm; null hides the plate. */
  bed?: [number, number] | null
  /** Print-up axis of the part's coordinates. Default [0,0,1]. */
  up?: Vec3
  section?: Section | null
  /** A view to restore, taken when it can still see the part; compared by value, so a parent may re-send it freely. */
  camera?: CameraState | null
  /** The user's orbits, debounced 250 ms after the last one. The component's own framing never reports. */
  onCamera?: (state: CameraState) => void
  className?: string
}

/** "off", without changing the clipping array's length and recompiling shaders (v1:960). */
const PARKED = 1e6

const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as const

interface Holder {
  renderer: WebGLRenderer | null
  scene: Scene
  camera: PerspectiveCamera
  controls: OrbitControls | null
  plane: Plane
  root: Group
  marks: Group
  cap: Mesh
  part: Group | null
  ghost: Mesh | null
  plate: Group | null
  writers: Mesh[]
  glows: Mesh[]
  box: Box3
  size: number
  cutting: boolean
  cutAxis: "x" | "y" | "z"
  cutSign: number
  framed: boolean
  generation: number
  /** The generation whose GLB is on screen; findings wait for it to catch up. */
  loaded: number
  targetGeneration: number
  /** Set while the component itself moves the camera, so onCamera reports only the user's orbits. */
  quiet: boolean
  lastW: number
  lastH: number
  raf: number
  camTimer: ReturnType<typeof setTimeout> | null
  render: () => void
}

const sameCamera = (a: CameraState | null | undefined, b: CameraState | null | undefined) => {
  if (!a || !b) return a === b
  return a.position.every((v, i) => v === b.position[i]) && a.target.every((v, i) => v === b.target[i])
}

const firstGeometry = (scene: Object3D): BufferGeometry | null => {
  let geometry: BufferGeometry | null = null
  scene.traverse((o) => {
    if ((o as Mesh).isMesh && !geometry) geometry = (o as Mesh).geometry
  })
  return geometry
}

/** A restored camera is taken only when it can still plausibly see the part (v1:1749-1771). */
function applyCamera(h: Holder, state: CameraState, box: Box3): boolean {
  if (!h.controls) return false
  const position = new Vector3().fromArray(state.position)
  const target = new Vector3().fromArray(state.target)
  if (!saneCamera(position, target, box)) return false
  h.camera.position.copy(position)
  h.controls.target.copy(target)
  const size = box.getSize(new Vector3())
  const span = Math.max(size.x, size.y, size.z) || 10
  h.camera.near = span / 100
  h.camera.far = span * 100
  h.camera.updateProjectionMatrix()
  h.controls.update()
  return cameraSeesBox(h.camera, box)
}

/** A rebuild is a geometry swap, never a camera reset (v1:839). Nothing is written to the camera on the keep path, so the view does not drift by a float. */
function keepCamera(h: Holder, box: Box3): boolean {
  if (!h.controls) return false
  if (!saneCamera(h.camera.position, h.controls.target, box)) return false
  return cameraSeesBox(h.camera, box)
}

/** Damping decays the orbit delta but never zeroes it, so the next render after the orbit stops spends the leftover and the view drifts. Dropping it is the only way to keep the camera to the float; update() would spend it instead. */
function dropDamping(h: Holder): void {
  const held = h.controls as unknown as {
    _sphericalDelta?: { set(theta: number, phi: number, radius: number): void }
    _panOffset?: { set(x: number, y: number, z: number): void }
    _scale?: number
  } | null
  if (!held) return
  held._sphericalDelta?.set(0, 0, 0)
  held._panOffset?.set(0, 0, 0)
  held._scale = 1
}

/** Plate the part and decide the camera: keep it when it still sees the part, else restore the caller's, else frame. */
function settle(h: Holder, wanted: CameraState | null | undefined): void {
  if (!h.part) return
  h.box = plateGroup(h.part)
  h.size = h.box.getSize(new Vector3()).length()
  h.quiet = true
  const taken = h.framed ? keepCamera(h, h.box) : wanted ? applyCamera(h, wanted, h.box) : false
  if (!taken && h.controls) frameCamera(h.camera, h.controls, h.box)
  h.quiet = false
  h.framed = true
}

function clearWriters(h: Holder) {
  for (const writer of h.writers) {
    h.scene.remove(writer)
    ;(writer.material as Material).dispose() // the geometry belongs to the part
  }
  h.writers = []
}

function attachWriters(h: Holder) {
  clearWriters(h)
  if (!h.part) return
  h.part.updateMatrixWorld(true)
  for (const child of h.part.children) {
    if (!(child as Mesh).isMesh || child.name === "context" || child.name === "target") continue
    for (const writer of stencilWriters(child as Mesh, h.plane)) {
      writer.visible = h.cutting
      h.scene.add(writer)
      h.writers.push(writer)
    }
  }
}

function applySection(h: Holder, section: Section | null | undefined) {
  if (!section) {
    h.cutting = false
    h.cutSign = 0
    h.cap.visible = false
    for (const writer of h.writers) writer.visible = false
    h.plane.constant = PARKED
    h.render()
    return
  }
  // The cut side is chosen once, from where the camera stood when the section opened or
  // the axis changed. A side that follows the camera swaps the surviving half mid-orbit (v1:1068-1073).
  if (!h.cutting || h.cutAxis !== section.axis) {
    h.cutting = true
    h.cutAxis = section.axis
    h.cutSign = 0
  }
  if (!h.part) {
    h.cap.visible = false
    h.plane.constant = PARKED
    h.render()
    return
  }
  const box = printedBox(h.part)
  const axis = section.axis
  const lo = box.min[axis]
  const hi = box.max[axis]
  if (!h.cutSign) h.cutSign = h.camera.position[axis] >= (lo + hi) / 2 ? 1 : -1
  const t = h.cutSign === 1 ? section.t : 1 - section.t
  // A hair inside the bounds at each end, so neither extreme is a cut through nothing (v1:1081).
  const at = lo + (hi - lo) * (0.02 + 0.96 * t)
  const dir = AXES[axis]
  h.plane.normal.set(-h.cutSign * dir[0], -h.cutSign * dir[1], -h.cutSign * dir[2])
  h.plane.constant = h.cutSign * at
  h.cap.visible = true
  for (const writer of h.writers) writer.visible = true
  const span = box.getSize(new Vector3()).length()
  h.cap.scale.set(span, span, 1)
  // Centered on the part, not on coplanarPoint, which is where the plane passes the world origin (v1:1084-1088).
  h.plane.projectPoint(box.getCenter(new Vector3()), h.cap.position)
  h.cap.lookAt(
    h.cap.position.x - h.plane.normal.x,
    h.cap.position.y - h.plane.normal.y,
    h.cap.position.z - h.plane.normal.z
  )
  h.render()
}

function rebuildMarks(h: Holder, findings: Finding[], highlight: number | null | undefined) {
  for (const child of h.marks.children) disposeGroup(child)
  h.marks.clear()
  h.glows = []
  if (!h.part) {
    h.render()
    return
  }
  const shift = h.part.position
  const scale = Math.max(0.6, h.size / 90)
  findings.forEach((finding, index) => {
    if (finding.face && finding.face.length) {
      const glow = glowMesh(finding.face, finding.severity, h.plane, palette)
      glow.position.copy(shift) // the same shift that plates the part
      glow.userData.finding = index
      if (index === highlight) {
        ;(glow.material as Material).opacity = HIGHLIGHT_OPACITY
        glow.add(glowOutline(finding.face, h.plane, palette))
      }
      h.marks.add(glow)
      h.glows.push(glow)
    }
    if (!finding.where) return
    const pin = pinMesh(
      [finding.where[0] + shift.x, finding.where[1] + shift.y, finding.where[2] + shift.z],
      finding.severity,
      scale,
      palette
    )
    h.marks.add(pin)
  })
  h.render()
}

export function ViewerIsland(props: ViewerIslandProps): JSX.Element {
  const { glbUrl, targetUrl, targetOffset, findings, highlight, bed, up, section, camera, className } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const holderRef = useRef<Holder | null>(null)
  const downRef = useRef<[number, number] | null>(null)
  const appliedCamera = useRef<CameraState | null>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new Scene()
    scene.background = new Color(palette.stage)
    const view = new PerspectiveCamera(45, 1, 0.1, 10000)
    view.up.set(0, 0, 1) // before OrbitControls, which reads it; never Object3D.DEFAULT_UP
    const root = new Group()
    const marks = new Group()
    root.add(marks)
    scene.add(root)
    for (const light of createLights()) scene.add(light)
    const cap = capMesh()
    scene.add(cap)

    const h: Holder = {
      renderer: null,
      scene,
      camera: view,
      controls: null,
      plane: new Plane(new Vector3(0, 0, -1), PARKED),
      root,
      marks,
      cap,
      part: null,
      ghost: null,
      plate: null,
      writers: [],
      glows: [],
      box: new Box3(),
      size: 0,
      cutting: false,
      cutAxis: "z",
      cutSign: 0,
      framed: false,
      generation: 0,
      loaded: 0,
      targetGeneration: 0,
      quiet: false,
      lastW: 0,
      lastH: 0,
      raf: 0,
      camTimer: null,
      render: () => {},
    }
    holderRef.current = h
    ;(container as HTMLDivElement & { __nurbViewer?: Holder }).__nurbViewer = h

    try {
      // stencil: the section cap is a stencil pass and the buffer is off by default since
      // r163. Without it the cap silently never draws.
      h.renderer = new WebGLRenderer({ antialias: true, stencil: true })
    } catch {
      // No GPU is not a crash: everything but the picture still works.
      container.setAttribute("data-nogl", "")
    }

    const canvas = h.renderer?.domElement ?? null
    if (h.renderer && canvas) {
      h.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      h.renderer.localClippingEnabled = true // per material, never renderer.clippingPlanes
      // Sized by CSS, never inline: setSize(w, h, false) must stay the only thing that
      // touches the drawing buffer. The renderer brings its own canvas because the
      // cleanup below loses its context, and a lost context cannot be reacquired on the
      // same element, which is what StrictMode's second mount would ask for.
      canvas.className = "block h-full w-full"
      container.appendChild(canvas)
      h.controls = new OrbitControls(view, canvas)
      h.controls.enableDamping = true
      h.controls.dampingFactor = 0.12
    }

    // Render on demand. Damping needs frames, so the loop keeps going only while
    // controls.update() reports the camera is still moving.
    const frame = () => {
      h.raf = 0
      if (!h.renderer || !h.controls) return
      const moving = h.controls.update()
      if (!moving) dropDamping(h) // the loop parks here, and a rebuild's render must not resume the orbit
      h.renderer.render(scene, view)
      if (moving) h.render()
    }
    h.render = () => {
      if (!h.renderer || h.raf) return
      h.raf = requestAnimationFrame(frame)
    }

    const resize = (w: number, ht: number) => {
      const width = Math.floor(w)
      const height = Math.floor(ht)
      if (!width || !height || (width === h.lastW && height === h.lastH)) return
      h.lastW = width
      h.lastH = height
      // The third argument is the whole point: `true` writes inline px onto the canvas,
      // and that write-back is what ratchets the observer (v1:926-937).
      h.renderer?.setSize(width, height, false)
      view.aspect = width / height
      view.updateProjectionMatrix()
      h.render()
    }
    const observer = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1].contentRect
      resize(rect.width, rect.height)
    })
    observer.observe(container)
    resize(container.clientWidth, container.clientHeight)

    const onChange = () => {
      h.render()
      if (h.quiet) return
      if (h.camTimer) clearTimeout(h.camTimer)
      h.camTimer = setTimeout(() => {
        const report = latest.current.onCamera
        if (!report || !h.controls) return
        report({
          position: h.camera.position.toArray() as Vec3,
          target: h.controls.target.toArray() as Vec3,
        })
      }, 250)
    }
    h.controls?.addEventListener("change", onChange)

    return () => {
      // StrictMode mounts, unmounts and mounts again, so a leaked context here is two contexts.
      observer.disconnect()
      if (h.raf) cancelAnimationFrame(h.raf)
      if (h.camTimer) clearTimeout(h.camTimer)
      h.generation++
      h.targetGeneration++
      h.controls?.removeEventListener("change", onChange)
      h.controls?.dispose()
      clearWriters(h)
      for (const child of marks.children) disposeGroup(child)
      if (h.part) disposeGroup(h.part)
      if (h.ghost) {
        h.ghost.geometry.dispose()
        ;(h.ghost.material as Material).dispose()
      }
      if (h.plate) disposeGroup(h.plate)
      disposeGroup(cap)
      h.renderer?.setAnimationLoop(null)
      h.renderer?.forceContextLoss()
      h.renderer?.dispose()
      canvas?.remove()
      delete (container as HTMLDivElement & { __nurbViewer?: Holder }).__nurbViewer
      holderRef.current = null
    }
  }, [])

  useEffect(() => {
    const h = holderRef.current
    if (!h || !h.controls) return
    const generation = ++h.generation
    const drop = () => {
      if (!h.part) return
      h.root.remove(h.part)
      if (h.ghost) h.part.remove(h.ghost)
      disposeGroup(h.part)
      h.part = null
    }
    if (!glbUrl) {
      drop()
      clearWriters(h)
      rebuildMarks(h, [], null)
      applySection(h, latest.current.section)
      return
    }
    new GLTFLoader()
      .loadAsync(glbUrl)
      .then((gltf) => {
        // GLTFLoader has no abort, so a late arrival is dropped rather than shown.
        if (generation !== h.generation) {
          disposeGroup(gltf.scene)
          return
        }
        const part = buildPartGroup(gltf.scene, h.plane, palette)
        drop()
        h.loaded = generation
        if (!part.children.length) {
          // A GLB with no mesh would plate to NaN and blank the viewer for good.
          clearWriters(h)
          rebuildMarks(h, [], null)
          applySection(h, latest.current.section)
          return
        }
        if (h.ghost) part.add(h.ghost)
        h.root.add(part)
        h.part = part
        settle(h, latest.current.camera)
        appliedCamera.current = latest.current.camera ?? null
        attachWriters(h)
        applySection(h, latest.current.section)
        rebuildMarks(h, latest.current.findings ?? [], latest.current.highlight)
        h.render()
      })
      .catch((error: unknown) => {
        if (generation === h.generation) console.warn(`ViewerIsland: could not load ${glbUrl}`, error)
      })
  }, [glbUrl])

  const offsetKey = (targetOffset ?? [0, 0, 0]).join(",")
  useEffect(() => {
    const h = holderRef.current
    if (!h || !h.controls) return
    const generation = ++h.targetGeneration
    if (h.ghost) {
      h.ghost.parent?.remove(h.ghost)
      h.ghost.geometry.dispose()
      ;(h.ghost.material as Material).dispose()
      h.ghost = null
    }
    if (!targetUrl) {
      h.render()
      return
    }
    new GLTFLoader()
      .loadAsync(targetUrl)
      .then((gltf) => {
        if (generation !== h.targetGeneration) {
          disposeGroup(gltf.scene)
          return
        }
        const geometry = firstGeometry(gltf.scene)
        if (!geometry) return
        if (!geometry.attributes.normal) geometry.computeVertexNormals()
        // Amber against the part's grey-blue, double-sided because a scan can be an open
        // surface, and never writing depth so the part reads through it (v1:843-848).
        const ghost = new Mesh(
          geometry,
          new MeshStandardMaterial({
            color: palette.ghost,
            metalness: 0,
            roughness: 0.9,
            transparent: true,
            opacity: 0.3,
            depthWrite: false,
            side: DoubleSide,
            clippingPlanes: [h.plane],
          })
        )
        ghost.name = "target"
        const offset = offsetKey.split(",").map(Number)
        ghost.position.set(offset[0], offset[1], offset[2])
        h.ghost = ghost
        h.part?.add(ghost)
        h.render()
      })
      .catch(() => {})
  }, [targetUrl, offsetKey])

  useEffect(() => {
    const h = holderRef.current
    if (!h || h.loaded !== h.generation) return // the load's own pass draws them on the new part
    rebuildMarks(h, findings ?? [], highlight)
  }, [findings, highlight])

  useEffect(() => {
    const h = holderRef.current
    if (!h) return
    if (h.plate) {
      h.scene.remove(h.plate)
      disposeGroup(h.plate)
      h.plate = null
    }
    if (bed) {
      h.plate = plate(bed)
      h.scene.add(h.plate)
    }
    h.render()
  }, [bed?.[0], bed?.[1], !bed])

  const upKey = (up ?? [0, 0, 1]).join(",")
  useEffect(() => {
    const h = holderRef.current
    if (!h) return
    // Everything else in the scene is Z-up, so the part's own up is rotated into it.
    const from = new Vector3(...(upKey.split(",").map(Number) as Vec3)).normalize()
    h.root.quaternion.setFromUnitVectors(from, new Vector3(0, 0, 1))
    h.root.updateMatrixWorld(true)
    if (h.part) {
      settle(h, latest.current.camera)
      applySection(h, latest.current.section)
      rebuildMarks(h, latest.current.findings ?? [], latest.current.highlight)
    }
    h.render()
  }, [upKey])

  useEffect(() => {
    const h = holderRef.current
    if (!h) return
    applySection(h, section)
  }, [section])

  useEffect(() => {
    const h = holderRef.current
    if (!h || !h.part || !camera) return
    if (sameCamera(camera, appliedCamera.current)) return
    appliedCamera.current = camera
    h.quiet = true
    const taken = applyCamera(h, camera, h.box)
    h.quiet = false
    if (taken) h.render()
  }, [camera])

  return (
    <div
      ref={containerRef}
      className={clsx("relative block h-full w-full", className)}
      onPointerDown={(e) => {
        downRef.current = [e.clientX, e.clientY]
      }}
      onPointerUp={(e) => {
        const down = downRef.current
        downRef.current = null
        const h = holderRef.current
        const report = latest.current.onHighlight
        // 5 px tells a click from the end of an orbit (v1's pick gate).
        if (!down || !h || !report || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return
        const rect = e.currentTarget.getBoundingClientRect()
        if (!rect.width || !rect.height) return
        const ndc = new Vector2(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          -((e.clientY - rect.top) / rect.height) * 2 + 1
        )
        const ray = new Raycaster()
        ray.setFromCamera(ndc, h.camera)
        const hit = ray
          .intersectObjects(h.glows, false)
          .find((i) => !h.cutting || h.plane.distanceToPoint(i.point) >= 0)
        report(hit ? (hit.object.userData.finding as number) : null)
      }}
    />
  )
}

export default ViewerIsland
