import type { ExportFormat, Finding, Message, Param, Params, Spec } from "@nurb/ui"

export interface ProjectSummary {
  id: string
  name: string
  created_at: string
  parts: number
  last_built: string | null
}

/** What the solver said about one shape under one weight. */
export interface StressResult {
  kg: number
  material: string
  max_mpa: number
  across_mpa: number
  deflection_mm: number
  elements: number
  pitch_mm: number
  holds_kg: number
  /** Null when the load barely registers; the headline says so rather than a number. */
  factor: number | null
  /** "layers" when the seams part first, which is what reorienting the print fixes. */
  gives: string
  glb_hash: string
  run_id: string
}

/** What the slicer said, or why it could not say anything. Only "slice" is a number. */
export interface SliceResult {
  kind: "slicer" | "printer" | "choose" | "profile" | "slice" | "build"
  error?: string
  profiles?: string[]
  seconds?: number
  spoken?: string
  grams?: number | null
  weight?: string | null
  profile?: string
  /** The full preset chain, worth having next to the number it produced. */
  settings?: string
  run_id?: string
}

export interface PartBuild {
  id: string
  status: "ok" | "error"
  passed: boolean
  started_at: string
  finished_at: string | null
  error: string | null
  findings: Finding[]
  stats: { bbox?: [number, number, number]; volume?: number; ms?: number; [key: string]: unknown }
  glb_url: string | null
  render_url: string | null
  stale: boolean
  stress: StressResult | null
  slice: SliceResult | null
}

export interface Part {
  id: string
  name: string
  kind: string
  revision_id: string
  revision: number
  source: string
  card_md: string | null
  params: Param[]
  /** The slider values the newest run was built at; empty when it ran on the defaults. */
  overrides: Params
  build: PartBuild | null
}

export interface ProjectMeasurement {
  name: string
  value_mm: number
  unit: string | null
  how: string
  provisional: boolean
  value_changed_at: string | null
}

export interface Printer {
  name: string
  bed: number[] | null
}

export interface Project {
  id: string
  name: string
  created_at: string
  printer: Printer | null
  /** Every profile the project could name, whether or not it has named one. */
  printers: string[]
  spec: Spec | null
  measurements: ProjectMeasurement[]
  parts: Part[]
  messages: Message[]
}

export interface ApplyResult {
  revision_id: string
  revision: number
  written: string[]
  skipped: { name: string; why: string }[]
  build: PartBuild
}

let base = ""
let resolver: (() => Promise<string>) | null = null

/** Point the client at another origin. The page leaves the base empty and stays same-origin. */
export function configure(opts: { base: string; resolve?: () => Promise<string> }): void {
  base = opts.base
  resolver = opts.resolve ?? null
}

/** The origin every request carries, which the live socket builds its own url from. */
export function apiBase(): string {
  return base
}

/** A reconnect's chance to learn a new port. Null when nobody asked to be asked. */
export function resolveBase(): Promise<string> | null {
  if (!resolver) return null
  return resolver().then((next) => (base = next))
}

/** A root-relative url from the server, made reachable from wherever the page runs. */
export function absolute(url: string): string {
  return base && url.startsWith("/") ? base + url : url
}

/**
 * A refusal the server answered with. The message stays the server's own sentence,
 * and the status rides along so a caller can tell a gone project from an outage.
 */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

// Every refusal is a sentence the server wrote for the person reading it, so it is
// passed through rather than replaced with a status code.
async function refusal(res: Response, fallback: string): Promise<ApiError> {
  const text = (await res.text()).trim()
  try {
    const said = JSON.parse(text) as { error?: string }
    if (said.error) return new ApiError(said.error, res.status)
  } catch {
    // Not every failure gets as far as the json writer.
  }
  return new ApiError(text || fallback, res.status)
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(base + url)
  if (!res.ok) throw await refusal(res, `${url} answered ${res.status}`)
  return (await res.json()) as T
}

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw await refusal(res, `${url} answered ${res.status}`)
  return (await res.json()) as T
}

const partUrl = (id: string, tail: string) => `/api/parts/${encodeURIComponent(id)}/${tail}`

export function fetchProjects(): Promise<{ projects: ProjectSummary[] }> {
  return get("/api/projects")
}

export function fetchProject(id: string): Promise<Project> {
  return get(`/api/projects/${encodeURIComponent(id)}`)
}

export function buildWithParams(
  partId: string,
  values: Params,
  signal?: AbortSignal
): Promise<{ build: PartBuild }> {
  return post(partUrl(partId, "params"), { values }, signal)
}

export function applyParams(partId: string, values: Params): Promise<ApplyResult> {
  return post(partUrl(partId, "apply"), { values })
}

export async function exportPart(partId: string, format: ExportFormat, values: Params): Promise<Blob> {
  const res = await fetch(base + partUrl(partId, "export"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, values }),
  })
  if (!res.ok) throw await refusal(res, "The download did not finish.")
  return res.blob()
}

export function stressPart(
  partId: string,
  kg: number,
  material: string,
  values: Params
): Promise<StressResult> {
  return post(partUrl(partId, "stress"), { kg, material, values })
}

export function slicePart(partId: string): Promise<SliceResult> {
  return post(partUrl(partId, "slice"), {})
}

export function setPrinter(projectId: string, profile: string): Promise<{ printer: Printer }> {
  return post(`/api/projects/${encodeURIComponent(projectId)}/printer`, { profile })
}

/** Put one line of the conversation in the project's own transcript. */
export function addMessage(
  projectId: string,
  role: "user" | "assistant",
  content: string
): Promise<Message> {
  return post(`/api/projects/${encodeURIComponent(projectId)}/messages`, { role, content })
}

export function createProject(name?: string): Promise<{ id: string; name: string }> {
  return post("/api/projects", name === undefined ? {} : { name })
}

export function importFolder(path: string): Promise<{ id: string; name: string; parts: number }> {
  return post("/api/import", { path })
}

export async function deleteProject(id: string): Promise<void> {
  const url = `/api/projects/${encodeURIComponent(id)}`
  const res = await fetch(base + url, { method: "DELETE" })
  if (!res.ok) throw await refusal(res, `${url} answered ${res.status}`)
}

export function openPublic(src: string): Promise<{ project_id: string; part: string }> {
  return post("/api/open", { src })
}
