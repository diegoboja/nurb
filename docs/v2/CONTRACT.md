# nurb contract — what the OSS repo ships and what nurb.app consumes

Draft 2026-09-13. This file is the coordination point between `~/development/nurb` (this repo, the product people install) and the private `nurb-app` repo (nurb.app, the parts host). Dependency runs one way: nurb.app depends on the artifacts below; this repo only calls nurb.app through the public HTTP API in §4 as an optional client. Every cross-repo handoff is a published version, never a branch.

## 1. Artifacts

| Artifact | Registry | Contains | Consumed by |
|---|---|---|---|
| `nurb` | PyPI | engine (build123d kernel, checks, doctrine, `measured()`), `nurb.server` (SQLite, viewer host, local MCP server), `nurb/tools.json` | nurb.app's Modal image (engine + `tools.json`), desktop app (`nurb serve`), Claude Code users (`nurb mcp`) |
| `@nurb/ui` | npm | design tokens CSS, `Icon`, `ViewerIsland`, `ParamsPanel`, `ExportMenu`, chat cards (`BuildCard`, `SpecCard`, `MeasurementCard`, markdown policy), transport-agnostic message types | desktop app, nurb.app's Inertia pages, the MCP App bundle |
| `skills/nurb` | this repo | "add the nurb MCP server, call `read_guide` first" | Claude Code, Codex, Cursor users without the desktop app |

Versions move in lockstep with the repo's single release version (engine + desktop + package). nurb.app pins both artifacts exactly.

## 2. `tools.json` — the tool contract

One file, shipped in the wheel, loaded by both servers (Python locally, Ruby on nurb.app). It holds every tool's `name`, `title`, `description`, `inputSchema` (full JSON Schema; the Anthropic-stripped variant is derived, never hand-maintained), `annotations` (`readOnlyHint` / `destructiveHint`), and the result shape in prose. A contract test in each repo diffs the served `tools/list` against this file.

| Tool | Kind | Result |
|---|---|---|
| `list_projects` | read | projects with part counts and last built |
| `get_project` | read | spec, measurements with `how` and `provisional`, parts with current source and last build summary |
| `create_project` | write | project id, placeholder name (never "Untitled") |
| `read_guide` | read | condensed doctrine + api vocabulary + build123d sheet, under 25,000 tokens |
| `pin_spec` / `amend_spec` | write | ok or validation errors; supersedes the prior spec |
| `read_measurements` | read | measurements + which parts read each |
| `record_measurement` | write | measurement, previous value, stale parts |
| `write_part_source` / `edit_part_source` | write, builds on save | findings, stats, inspect lines, ONE composite 2×2 render (PNG, under 150,000 base64 chars) + a resource link to the full-size render |
| `run_build` | write | same as above without a source change |
| `read_findings` | read | paged findings for the last build |
| `look` | read | the composite render + resource link |
| `find_photos` | read | up to N reference images, downscaled |
| `publish_part` | write | visibility, slug, public URL (nurb.app only; the local server returns an error until signed in) |
| `check_messages` | read | messages the user typed in the workbench since the last call (also appended to every tool result) |
| `get_public_part` | read | source, measurements, card for a public slug (nurb.app only) |

Every write tool takes an optional `note` (plain words, becomes the assistant's line in the transcript). Every result stays under 150,000 characters and 240 seconds (claude.ai limits); Claude Code caps MCP output at 25,000 tokens.

## 3. `@nurb/ui` surface

Exports (initial): `tokens.css`, `Icon`, `ViewerIsland`, `ParamsPanel`, `ExportMenu`, `BuildCard`, `SpecCard`, `MeasurementCard`, `AssistantMarkdown`, `ToolStepCard`, and the types `Message`, `BuildEvent`, `Spec`, `Finding`, `Params`. Components take data and callbacks; no ActionCable, ACP, Inertia or Tauri imports inside the package. Peer deps: react 19, three 0.185.

## 4. nurb.app public HTTP API (client lives in this repo)

- **OAuth 2.1**: `https://nurb.app/.well-known/oauth-authorization-server`, PKCE S256, public client `nurb-desktop` (pre-registered) with loopback redirect `http://127.0.0.1:<port>/callback`, scope `mcp`. Refresh tokens rotate. Token stored in Keychain.
- **MCP**: `POST https://nurb.app/mcp` (Streamable HTTP, stateless, bearer). Same `tools.json`.
- **Sync** (draft): `PUT /sync/projects/:local_id` with parts (source, card), measurements, printer profile, and the local GLB hash per part; response returns hosted ids, the hosted GLB hash and a parity flag. `GET /sync/projects/:id/changes?since=` for the explicit Pull. One-way push by default.
- **Public pages**: `https://nurb.app/p/<slug>`; deep link `nurb://open?src=https://nurb.app/p/<slug>` pulls source and measurements into a new local project.
- A signed-out local app makes zero requests to nurb.app (tested in both repos).

## 5. Handoff ladder

| # | Repo | Ships | Awaits | Status |
|---|---|---|---|---|
| 1 | nurb | `tools.json`, SQLite schema, `nurb serve`, `nurb mcp` → `nurb 1.0.0a1` | — | planned |
| 2 | nurb | `@nurb/ui 1.0.0-alpha.1` extracted from nurb-app's `web/app/frontend` (one-time reverse flow) | read access to nurb-app | planned |
| 3 | nurb-app | engine overlay on the wheel, `@nurb/ui` imported, parity test | 1, 2 | planned |
| 4 | nurb-app | public part pages, Ruby MCP server loading `tools.json`, OAuth server | 3 | planned |
| 5 | nurb | desktop rebuilt on `@nurb/ui`, ACP sessions receive the local MCP server | 2 | planned |
| 6 | nurb-app | `/sync` API, `nurb-desktop` OAuth client | 4 | planned |
| 7 | nurb | `nurb login`, Publish, Back up, `nurb://open` | 6 | planned |
| 8 | both | MCP App, directory, remix lineage | 4, 7 | planned |

Update the status column from each repo's PROGRESS.md as handoffs ship. A phase that changes §2–§4 bumps this file first.
