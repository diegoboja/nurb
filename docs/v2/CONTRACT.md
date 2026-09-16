# nurb contract — what the OSS repo ships and what nurb.app consumes

Draft 2026-09-13. This file is the coordination point between `~/development/nurb` (this repo, the product people install) and the private `nurb-app` repo (nurb.app, the parts host). Dependency runs one way: nurb.app depends on the artifacts below; this repo only calls nurb.app through the public HTTP API in §4 as an optional client. Every cross-repo handoff is a published version, never a branch.

## 1. Artifacts

| Artifact | Registry | Contains | Consumed by |
|---|---|---|---|
| `nurb` | this public repo at a commit (`pip install "nurb @ git+https://github.com/Shpigford/nurb@<sha>"`); no PyPI release, no console script (decided 2026-09-16) | engine (build123d kernel, checks, doctrine, `measured()`, `nurb.raster`), `nurb.server` (SQLite, viewer host, local MCP server, relay client), `nurb/tools.json` | nurb.app's Modal image (engine only, for public rebuilds, pinned by sha); the desktop app, which bundles the wheel and spawns `python -m nurb.serve` |
| `@nurb/ui` | this repo only (npm workspace `packages/ui`, never published; ladder 4 dropped 2026-09-15) | design tokens CSS, `Icon`, `ViewerIsland`, `ParamsPanel`, `ExportMenu`, chat cards (`BuildCard`, `SpecCard`, `MeasurementCard`, markdown policy), transport-agnostic message types | desktop app, `packages/workbench`. nurb.app keeps its own frontend |

Versions move in lockstep with the repo's single release version (engine + desktop + package). nurb.app pins a commit sha of this repo and bumps it by hand.

The product has three doors and one server (decided 2026-09-16): the desktop app (its own chat: the Claude driver, Codex and Gemini over ACP), the app's local MCP endpoint for Claude Code, the Codex CLI or Cursor on the same machine (the app's Settings shows the connect command with the URL and token), and the nurb.app relay for claude.ai and ChatGPT. There is no `nurb` command line and no skill file; the server's MCP `instructions` carry the "call `read_guide` first" rule to every client.

## 2. `tools.json` — the tool contract

One file, shipped in the wheel, implemented by the local server only. nurb.app never serves tools; its `/mcp` endpoint relays to the user's running desktop app (§4). The server's `initialize` result carries `instructions` (read the guide first, the workbench URL habit) so no client needs a skill file. It holds every tool's `name`, `title`, `description`, `inputSchema` (full JSON Schema; the Anthropic-stripped variant is derived, never hand-maintained), `annotations` (`readOnlyHint` / `destructiveHint`), and the result shape in prose. A contract test here diffs the served `tools/list` against this file.

| Tool | Kind | Result |
|---|---|---|
| `list_projects` | read | projects with part counts and last built |
| `get_project` | read | spec, measurements with `how` and `provisional`, parts with current source and last build summary |
| `create_project` | write | project id, placeholder name (never "Untitled") |
| `read_guide` | read | condensed doctrine + api vocabulary + build123d sheet, under 25,000 tokens |
| `pin_spec` / `amend_spec` | write | ok or validation errors; supersedes the prior spec |
| `read_measurements` | read | measurements + which parts read each |
| `record_measurement` | write | measurement, previous value, stale parts |
| `write_part_source` / `edit_part_source` | write, builds on save | findings, stats, inspect lines, ONE composite 2×2 render (PNG, under 80,000 base64 chars) + a resource link to the full-size render |
| `run_build` | write | same as above without a source change |
| `read_findings` | read | paged findings for the last build |
| `look` | read | the composite render + resource link |
| `find_photos` | read | up to N reference images, downscaled |
| `publish_part` | write | visibility, slug, public URL (calls the nurb.app sync API; errors until signed in) |
| `get_public_part` | read | source, measurements, card for a public slug (fetched from nurb.app) |

Every write tool takes an optional `note` (plain words, becomes the assistant's line in the transcript). Every result stays under 150,000 characters and 240 seconds (claude.ai limits, enforced here and checked by the relay); Claude Code caps MCP output at 25,000 tokens.

## 3. `@nurb/ui` surface

Internal since 2026-09-15: the package is consumed inside this repo only (desktop app, workbench) and is not published to npm. nurb.app keeps its own frontend; a viewer change it wants is copied by hand. The surface below still binds the two in-repo consumers.

Exports (initial): `tokens.css`, `Icon`, `ViewerIsland`, `ParamsPanel`, `ExportMenu`, `BuildCard`, `SpecCard`, `MeasurementCard`, `AssistantMarkdown`, `ToolStepCard`, `ToolStepGroup`, and the types `Message`, `BuildEvent`, `Spec`, `Finding`, `Params`. Components take data and callbacks; no ActionCable, ACP, Inertia or Tauri imports inside the package. Peer deps: react 19, three 0.185. Components are styled with Tailwind 4 utilities and `tokens.css` is a Tailwind source file (`@theme static`, the `@utility` set); a consumer runs Tailwind 4 and adds `@source "../node_modules/@nurb/ui/dist"`. Satoshi is named in the tokens but never shipped (Fontshare license); the consumer supplies it. Instrument Sans and JetBrains Mono ship under the OFL.

## 4. nurb.app public HTTP API (client lives in this repo)

- **OAuth 2.1**: `https://nurb.app/.well-known/oauth-authorization-server`, PKCE S256, public client `nurb-desktop` (pre-registered) with loopback redirect `http://127.0.0.1:<port>/callback`, scopes `sync` and `mcp`. Refresh tokens rotate. Token stored in Keychain.
- **Sync** (draft, finalised by nurb-app Phase 25): `PUT /sync/projects/:local_id` with parts (source, card, `parent_revision_id`, `note`), measurements (value, `how`, `provisional`), printer profile; response carries hosted ids and a `needs_upload` list. `POST /sync/uploads` returns presigned R2 PUT URLs for a part's GLB and thumbnail by content hash; `POST /sync/builds` records the build (hash, stats, findings) once uploaded. `GET /sync/projects/:id/changes?since=` for the explicit Pull. Parent mismatch is a 409 carrying the hosted head. One-way push by default; local is the truth.
- **Relay**: the desktop app holds one authenticated WebSocket (`DesktopChannel`) to nurb.app while running and answers forwarded MCP JSON-RPC requests from the local server, correlated by id, within 240 s and 150,000 characters. claude.ai and ChatGPT connect to `https://nurb.app/mcp` with their own OAuth; nurb.app forwards and returns, stores nothing. The envelope is documented in nurb-app `docs/ops/relay.md` and is protocol-agnostic (a nurb iOS app is a planned second front door).
- **Public pages**: `https://nurb.app/p/<slug>`; deep link `nurb://open?src=https://nurb.app/p/<slug>` pulls source and measurements into a new local project.
- A signed-out local app makes zero requests to nurb.app (tested in both repos).

## 5. Handoff ladder

nurb.app runs no tools and no model. It ships identity, sync, public pages and a relay; this repo ships the wheel, the desktop client and the relay client.

| # | Repo | Ships | Awaits | Status |
|---|---|---|---|---|
| 1 | nurb-app | OAuth server + `nurb-desktop` public client (loopback, PKCE) — nurb-app Phase 24 | — | shipped 2026-09-14 (nurb-app #47) |
| 2 | nurb-app | Sync API: publish, back up, pull, presigned uploads, `GET /p/<slug>.json` — nurb-app Phase 25 | 1 | shipped 2026-09-14 (nurb-app #48) |
| 3 | nurb | the v2 engine importable from a pushed commit of this repo: `src/nurb` with `builder`, `checks`, `raster`, `printers.toml`, `tools.json` (redefined 2026-09-15; there is no PyPI release, nurb.app installs from the pinned commit) | — | shipped: `v2` merged to main as `1.0.0a1` (2026-09-16), commit `<sha>`; nurb.app pins that commit |
| 4 | nurb | ~~`@nurb/ui 1.0.0-alpha.1` on npm~~ | — | dropped 2026-09-15: the package stays a workspace dependency of the desktop app and the workbench; nurb.app keeps its own frontend. Phase 14 removes the `npm` job from `publish.yml` |
| 5 | nurb | desktop rebuilt on `@nurb/ui`; Sign in, Publish, Back up, Pull, `nurb://open` handler | 1, 2, 3 | desktop half landed on main with 1.0.0a1 (Phase 14, 2026-09-16); bridge half is Phase 15 |
| 6 | nurb-app | Relay door `/mcp` + connector OAuth + `DesktopChannel` envelope (`docs/ops/relay.md`) — nurb-app Phase 28 | 1 | shipped 2026-09-14 (nurb-app #51; the reply arrives as one SSE event after keep-alive comments, `taken` is followed by `reject_subscription`, `bin/fake-desktop` there is the reference client) |
| 7 | nurb | Relay client in the desktop app: holds the `DesktopChannel` connection, answers forwarded MCP requests from the local server | 3, 6 | planned |
| 8 | nurb-app | engine overlay pinned to a commit of this repo, parity test — nurb-app Phase 30 | 3 | unblocked by 3 |
| — | nurb-app | Public pages `/p/<slug>` + `nurb://open` contract — nurb-app Phase 22 | — | shipped 2026-09-13; sliders, indexing and the directory followed (Phases 26, 27, 29, merged by 2026-09-14) |

A phase on the consuming side checks the registry or the contract before starting and stops with "blocked on ladder N" if the artifact is missing; it never stubs or vendors it. Update the status column from each repo's PROGRESS.md as handoffs ship. A phase that changes §2–§4 bumps this file first.
