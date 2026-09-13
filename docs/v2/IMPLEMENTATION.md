# nurb v2 Implementation Plan

## Overview

v2 resets the product layer and keeps the engine and the Tauri core. SQLite becomes the truth, agents work through MCP tools served by `nurb serve`, the viewer and app UI are rebuilt on one React package (`@nurb/ui`), and the desktop app drives the unmodified `claude` binary directly for the Claude path while Codex and Gemini stay on ACP. An optional bridge to nurb.app (sign in, Publish, Back up) closes the plan and is blocked until nurb-app ships its side. Decisions and evidence are in `docs/v2/RESEARCH.md`; the cross-repo contract is `docs/v2/CONTRACT.md`.

The handoff ladder in CONTRACT §5 orders this plan. nurb.app runs no tools and no model: it ships identity, sync, public pages and a relay. This repo ships the wheel with `tools.json` (ladder 3), `@nurb/ui` (ladder 4), the desktop rebuilt with the bridge (ladder 5, awaits nurb-app's OAuth and sync), and the relay client (ladder 7, awaits nurb-app's relay door). Ladders 3 and 4 await nothing, so the plan runs them first. A phase that consumes another repo's artifact checks the registry or the contract before starting and stops with "blocked on ladder N" if it is missing; it never stubs or vendors the artifact.

Research done for this plan found three things worth knowing before starting: nurb-app's nine Ruby tool `DEFINITION` hashes and its `hosted.py` build sequence are the reference for `tools.json` and the build path, but nurb-app will not serve tools itself; the "2x2 composite" is today four separate 640x400 PNGs stitched in Ruby (v2 composites them in the wheel); and `ToolStepCard` and `AssistantMarkdown` do not exist as components (v2 creates them). `check_messages` was removed from the contract on 2026-09-13, so no tool result carries workbench messages and the workbench transcript is read-only.

## Prerequisites

- `uv` and Python 3.13, Node 22, Rust toolchain for the desktop; `claude` CLI at v2.1.221 or newer signed into a subscription (needed for `--mcp-config` waits and the bench gate).
- Read access to the nurb-app worktree for the one-time `@nurb/ui` extraction (Phase 1). Its `docs/core/PROGRESS.md` tail holds learnings to mine.
- `v0.26.0` is tagged as the last v1; v2 lands on `main` and ships as `1.0.0a1`. No `legacy/` folder; git history is the reference.

## Phase Summary

| # | Phase | Ladder | What the user can do after it |
|---|---|---|---|
| 1 | `@nurb/ui`: the package and the cards | 4 | Browse tokens, icons, cards, params and export UI in a gallery page |
| 2 | ViewerIsland | 4 | Orbit a real GLB with findings glow, section and ghost in React; `@nurb/ui 1.0.0-alpha.1` on npm |
| 3 | Database, contract, and the build tools | 3 | Add `nurb mcp` to Claude Code and have it build a part into rows |
| 4 | Guide, spec, look, and the render | 3 | Claude reads the doctrine, pins a spec, and sees its own part |
| 5 | Checkout, folder CLI, and the bench gate | 3 | Round-trip a project to a folder; six bench tasks pass through the tool path |
| 6 | The workbench | 3, 4 | Open `localhost:7373`, drag sliders, export, read the transcript |
| 7 | Desktop shell on `@nurb/ui` | 5 | Launch the app, see projects as rows, use the viewer in-process, open a public part by link |
| 8 | The Claude driver | 5 | Chat with Claude Code inside the app; it edits parts through tools |
| 9 | MCP into ACP sessions | 5 | Codex and Gemini use tools; the folder fallback covers the rest |
| 10 | Skill, docs, and the 1.0.0a1 release | 3 | Install from PyPI; the skill says "add the MCP server" |
| 11 | The nurb.app bridge | 5 (awaits 1, 2) | Sign in, Publish, Back up, Pull |
| 12 | The relay client | 7 (awaits 6) | Use your nurb from claude.ai or ChatGPT while the app is open |

---

## Phase 1: `@nurb/ui`: the package and the cards

### Objective

An npm workspace at the repo root with `packages/ui` holding the design tokens, `Icon`, `BuildCard`, `SpecCard`, `MeasurementCard`, `ToolStepCard`, `AssistantMarkdown`, `ParamsPanel`, `ExportMenu`, and the shared types, all transport-agnostic, viewable in a gallery page.

### Rationale

This is the one-time reverse flow from nurb-app. Extracting the pure pieces first (tokens, Icon, the three cards) gives an immediately visible result; decoupling `ParamsPanel`, `ExportMenu` and `MeasurementCard` from Inertia and ActionCable is the real work.

### Tasks

- [ ] Root `package.json` with workspaces `desktop` and `packages/*`; move `desktop/` onto the workspace lockfile. `packages/ui` builds with Vite library mode, peer deps react 19 and three 0.185, TypeScript strict.
- [ ] Copy from nurb-app `web/app/frontend`: `entrypoints/application.css` `@theme` block as `tokens.css` (fonts referenced by relative URL; Satoshi variable font shipped in the package), `components/ui/Icon.tsx`, `components/chat/BuildCard.tsx`, `SpecCard.tsx`, `assistantMarkdownPolicy.ts`.
- [ ] Decouple: `MeasurementCard` takes `onAccept`/`onEdit` callbacks instead of Inertia `router`; `ParamsPanel` takes `onChange`/`onApply` callbacks and `paramsState.ts` moves with it; `ExportMenu` takes an `export(format, profile)` promise and a `status` prop instead of `useProjectChannel`.
- [ ] New: `ToolStepCard` (one collapsed line: verb, object, elapsed in tabular mono, chevron to expand input and output) and `AssistantMarkdown` (react-markdown with the disallowed-elements policy). Types split out of `useConversation.ts` into `types.ts`: `Message`, `BuildEvent`, `Spec`, `Finding`, `Params`.
- [ ] `packages/ui/gallery`: a Vite page rendering every component with fixture data in light and dark, used for screenshots. Run the `design` skill's render step against it.
- [ ] Vitest smoke tests: each component renders with fixture props; `tokens.css` parses; the package's public exports match CONTRACT §3.

### Success Criteria

- `npm run build --workspace packages/ui` succeeds and `dist/` contains no import of `@inertiajs`, `@rails/actioncable`, or `@tauri-apps`.
- `npm test --workspace packages/ui` passes.
- The gallery page renders `BuildCard` with three steps collapsed to a single "3 steps" line that expands on click, captured in `docs/v2/screenshots/phase-1-build-card.png`.
- `ToolStepCard` shows an elapsed counter in tabular figures with no pulsing indicator, captured in `docs/v2/screenshots/phase-1-tool-step.png`.
- The package's `index.ts` exports exactly the names listed in CONTRACT §3 (test asserts the set).

### Files Likely Affected

`package.json` (root), `package-lock.json`, `packages/ui/**`, `desktop/package.json`, `docs/v2/screenshots/`.


---

## Phase 2: ViewerIsland

### Objective

`ViewerIsland` renders the part with three.js inside React: Z-up, camera persistence across rebuilds, findings glow from face triangles, section plane, target ghost, assembly joints, and a `bed` outline from the printer profile. No iframe, no postMessage.

### Rationale

The viewer is the product's center and the source of the shell's state-duplication bugs. Porting the rendering out of `viewer.html` into a component ends the iframe seam and gives nurb-app the same viewer when it adopts the package.

### Tasks

- [ ] Read `src/nurb/viewer.html` for the rendering behaviors to keep: GLB load and swap without moving the camera, `shape_id` keyed camera reset rules, finding face glow, section plane with the cap, ghost target mesh, joint nodes, bed and grid, light and dark materials. Note each in PROGRESS.md before porting.
- [ ] `ViewerIsland` props: `glbUrl`, `targetUrl`, `findings`, `highlight`, `bed`, `up`, `section`, `onCamera`. Camera state persisted by the caller through `onCamera` and an initial `camera` prop.
- [ ] Load GLBs with three's `GLTFLoader` and BVH for picking is out of scope; keep the current raycast on click for findings.
- [ ] Gallery entries: a real GLB from `nurb export --formats glb` in `examples/notch`, one with findings, one sectioned, one with a ghost.
- [ ] Ship ladder 4: bump `pyproject.toml` to `1.0.0a1` and `packages/ui` to `1.0.0-alpha.1` (write the PEP 440 to semver mapping once and test it against `tauri.conf.json` too), add the npm publish job with provenance to `.github/workflows/publish.yml`, publish `@nurb/ui 1.0.0-alpha.1`, and mark ladder 4 shipped in CONTRACT §5.
- [ ] Resize handling that does not ratchet: the ResizeObserver test from v1 (`viewer.html` lessons in CLAUDE.md) becomes a Vitest case with an initial size mismatch.

### Success Criteria

- Swapping `glbUrl` to a rebuilt GLB with the same `shape_id` leaves the camera position unchanged (test asserts equality of camera matrices before and after).
- A finding with face triangles renders as a highlighted overlay visible in `docs/v2/screenshots/phase-2-finding-glow.png`.
- The section slider cuts the mesh and the cut face is capped, captured in `docs/v2/screenshots/phase-2-section.png`.
- Mounting the component in a container that then shrinks by 200 px settles in one resize with no further ResizeObserver callbacks (test counts callbacks).
- `npm run build --workspace packages/ui` still contains no iframe or `postMessage` reference.
- `npm view @nurb/ui@1.0.0-alpha.1` resolves on the registry and CONTRACT §5 shows ladder 4 as shipped.

### Files Likely Affected

`packages/ui/src/viewer/ViewerIsland.tsx`, `packages/ui/src/viewer/*.ts`, `packages/ui/gallery/`, `packages/ui/package.json`, `pyproject.toml`, `desktop/src-tauri/tauri.conf.json`, `tests/test_cli.py`, `.github/workflows/publish.yml`, `docs/v2/CONTRACT.md`, `docs/v2/screenshots/`.


---

## Phase 3: Database, contract, and the build tools

### Objective

`nurb serve` owns one SQLite database, serves the MCP tool contract from `tools.json` over Streamable HTTP and stdio, and builds parts from rows through a materialized scratch directory. Claude Code, with `claude mcp add nurb -- nurb mcp`, can create a project and write a part that builds.

### Rationale

Everything on the Python side stands on the database and the contract. The materializer keeps the engine and `measured()` untouched, so the engine suite never goes red. Shipping the MCP path against a real agent before any UI exists is the first proof of the tool loop, and the relay (Phase 12) forwards to this same server, so the contract is written once here.

### Tasks

- [ ] Add `mcp` to `pyproject.toml` dependencies; remove `watchdog`; keep `websockets` (uvicorn uses it for the websocket route). Record the transitive cost (26 packages, ~27 MB) in the README's dependency note.
- [ ] `src/nurb/db.py`: schema and migrations in plain `sqlite3`, WAL mode, UUID text ids. Tables: `projects`, `parts` (`current_revision_id`, name regex `^[a-z][a-z0-9_]*$`), `part_revisions` (`source`, `card_md`, `params`, `parent_id`), `build_runs` (`status`, `error`, `findings`, `inspect_report`, `stats`, `params`, `overrides`, `glb` blob, `render` blob), `measurements` (`name`, `value`, `unit`, `how`, `provisional`, `value_changed_at`), `messages` (`project_id`, `role`, `content`, `payload`, `sequence_number`), `pinned_specs`. Database path from `NURB_HOME`, default next to `config.toml` under the existing `checks.global_file()` convention.
- [ ] `src/nurb/materialize.py`: write `<scratch>/parts/<name>.py`, `<scratch>/parts/<name>.md` (when a card exists), `<scratch>/measurements.toml` (float values, `unit = "mm"`, `how`, `provisional` only when true), `<scratch>/printer.toml` from the project's printer choice, and root-level shared modules. Snapshot, not overlay: clear `parts/*` first.
- [ ] `src/nurb/engine_run.py` (name to taste): the one function `run_build(scratch, part, overrides, profile)` mirroring nurb-app's `hosted.py` sequence: name guard, `builder.build`, `checks.printer` + `checks.from_card` (a bad card is a `card` finding, never hides geometry), `builder.to_glb`, `builder.stats`, `checks.run`, `probe.finding_faces`, `probe.report` (limit 12, failure becomes one line). Returns findings, stats, inspect lines, GLB bytes, trimmed traceback on error.
- [ ] `src/nurb/tools.json`: every tool in CONTRACT §2 with `name`, `title`, `description`, full JSON Schema `inputSchema`, `annotations`, and `_meta["anthropic/maxResultSizeChars"]` where results can be large. Every write tool takes `note`. Start from nurb-app's nine Ruby `DEFINITION` hashes. Add it to `source-include`.
- [ ] `src/nurb/mcp_server.py`: low-level `mcp.server.Server` with `on_list_tools` loading `tools.json` via `Tool.model_validate`, `on_call_tool` dispatching by name, `jsonschema` validation of arguments in the dispatcher returning `is_error` results (never a protocol error). Implement `list_projects`, `get_project`, `create_project` (placeholder names, never "Untitled"), `read_measurements`, `record_measurement` (returns previous value and stale parts), `write_part_source`, `edit_part_source`, `run_build`, `read_findings`. Build tools return findings, stats, inspect lines and a resource link to the render; the composite image itself lands in Phase 2.
- [ ] `src/nurb/serve.py`: Starlette app run by uvicorn on one port (7373 or next free), mounting the MCP app at `/mcp` (stateless, JSON responses), `GET /glb/<part>.glb`, `GET /render/<part>.png`, and `GET /api/state` for now. Writes `serve.json` (port, pid, token) under `NURB_HOME`. One process owns the database: the file lock is the guard, a second `nurb serve` exits with the running one's URL.
- [ ] `nurb mcp`: a stdio proxy that reads `serve.json`, starts `nurb serve` detached when nothing is running, and forwards every MCP request to `/mcp`. Claude Code and the desktop app always reach the database through the serving process.
- [ ] `nurb import <dir>`: a v1 folder becomes a project: parts (one revision each, card from the `.md`), measurements with `how` from the TOML, printer choice from `printer.toml`. Import `examples/notch` as the first fixture.
- [ ] Contract test: an in-process `mcp.client.Client` diffs `tools/list` (dumped `by_alias`, `exclude_none`, `mode="json"`) against `tools.json` byte for byte.
- [ ] Update `docs/v2/CONTRACT.md`: the composite is produced by the wheel; ladder 3 status "in progress".
- [ ] Delete `src/nurb/server.py`, `src/nurb/edit.py`'s on-disk rewrite path (keep the AST edit as a pure function for `edit_part_source`), `nurb dev`, `nurb new`, `nurb launcher`, and their tests. Port the crash-restart, variant-matching and shape-id invariants from `tests/test_server.py` to the new server tests before deleting the file.

### Success Criteria

- `uv run pytest tests/test_examples.py tests/test_rules.py tests/test_notch_fit.py` passes unchanged after the dependency change.
- `uv run pytest tests/test_contract.py` passes and the test compares the served tool list to `src/nurb/tools.json` with an exact equality assertion.
- Starting `nurb serve` twice leaves one process holding the database and the second invocation exits with the first one's URL on stdout.
- `nurb import examples/notch` creates one project whose part count equals the number of `examples/notch/parts/*.py` files that do not start with an underscore.
- In a fresh Claude Code session with `claude mcp add nurb -- nurb mcp`, `/mcp` lists the nurb server as connected with the tools from `tools.json`.
- Calling `write_part_source` with a part that raises inside build123d returns a result whose traceback starts in the part's own file and whose `is_error` is false (a failed build is a result, not a protocol error).
- Calling `write_part_source` with an argument that violates `inputSchema` returns a result with `is_error` true and a message naming the offending field.
- Calling `record_measurement` for a name a part reads returns that part in `stale_parts`.
- `GET /glb/<part>.glb` on the serve port returns the GLB from the part's latest successful build run.

### Files Likely Affected

`pyproject.toml`, `src/nurb/db.py`, `src/nurb/materialize.py`, `src/nurb/engine_run.py`, `src/nurb/tools.json`, `src/nurb/mcp_server.py`, `src/nurb/serve.py`, `src/nurb/cli.py`, `src/nurb/edit.py`, `src/nurb/server.py` (deleted), `tests/test_server.py` (replaced), `tests/test_contract.py`, `tests/test_db.py`, `tests/test_cli.py` (pruned), `docs/v2/CONTRACT.md`, `README.md`.


---

## Phase 4: Guide, spec, look, and the render

### Objective

The remaining tools land: `read_guide`, `pin_spec`, `amend_spec`, `look`, `find_photos`. Build results carry one composite 2x2 render produced inside the wheel with no browser, and `nurb render` uses the same rasterizer.

### Rationale

Seeing the part is what made the file-based loop work; the tool loop needs it before an agent can be trusted on real prompts. Putting the rasterizer in the wheel removes the playwright extra and keeps renders offline.

### Tasks

- [ ] Port nurb-app's `engine/src/nurb/thumbnail.py` into `src/nurb/raster.py`: numpy painter's-order rasterizer, the four views (`iso`, `back`, `top`, `under`), the five-tone palette, 2x supersample. Encode PNG with `zlib` and `struct`, no Pillow. numpy is already transitive through build123d.
- [ ] `composite(glb_bytes)`: one 2x2 PNG with view captions, sized to stay under 80,000 base64 characters. Measure on the bench fixtures and record the sizes in PROGRESS.md.
- [ ] `read_guide`: condensed doctrine plus `api` vocabulary plus a build123d sheet under 25,000 tokens, assembled at build time from `doctrine.md` and `api.py` so it cannot drift. A test asserts the token ceiling with a character proxy.
- [ ] `pin_spec` / `amend_spec`: validation and merge rules mirrored from nurb-app's `operator.rb` (`normalize`, `errors`, `AmendSpec.merge`); a pinned spec supersedes the prior one.
- [ ] `look`: the composite plus a resource link; `find_photos`: up to N downscaled reference images from the project's attachments.
- [ ] `nurb render [part]` writes `build/renders/<part>.png` through the rasterizer; drop the `render` extra and `src/nurb/render.py`'s browser path. `--section` stays as a cut through the mesh.
- [ ] Derive the Anthropic-stripped schema variant mechanically (drop `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`, `pattern`; fold them into descriptions; `oneOf` to `anyOf`; inline `$ref`; force `additionalProperties: false`). Property test: the output contains none of the banned keywords. Ship it as `nurb api --anthropic` for nurb-app to consume.
- [ ] MCP resources: `list_resources` and `read_resource` serve the full-size renders as `BlobResourceContents`.

### Success Criteria

- `write_part_source` on the `cable_clip` bench fixture returns exactly one `ImageContent` whose base64 length is under 80,000 characters and one `ResourceLink` to the full-size render.
- `read_guide` returns text under 100,000 characters and its first line names the doctrine version matching `pyproject.toml`.
- `pin_spec` with a spec missing a required field returns validation errors naming that field and does not create a `pinned_specs` row.
- `nurb render` in `examples/notch` writes a PNG for every part without playwright installed.
- `nurb api --anthropic` output contains no `pattern`, `minimum`, `maximum`, `minLength`, `maxLength` or `oneOf` keys.

### Files Likely Affected

`src/nurb/raster.py`, `src/nurb/mcp_server.py`, `src/nurb/tools.json`, `src/nurb/guide.py`, `src/nurb/spec.py`, `src/nurb/render.py`, `src/nurb/cli.py`, `pyproject.toml`, `tests/test_raster.py`, `tests/test_tools.py`, `tests/test_guide.py`.


---

## Phase 5: Checkout, folder CLI, and the bench gate

### Objective

Rows round-trip to a folder and back, the engine CLI keeps working on a folder unchanged, and the six benchmark tasks pass through the tool path.

### Rationale

Git users and the benchmark scorer both want a folder. The gate is the guard against the second-system effect: v1 is not retired until the tool path scores where the file path did.

### Tasks

- [ ] `nurb checkout <project> <dir>`: writes the v1 folder shape (`parts/*.py`, `parts/*.md`, `measurements.toml`, `printer.toml`). `nurb import` of that folder produces equal rows (idempotent round trip, tested).
- [ ] Engine commands (`build`, `check`, `inspect`, `scan`, `compare`, `verify`, `extract`, `card`, `diff`, `slice`, `stress`, `export`, `rules`, `api`) keep `project_root()` folder semantics; no database awareness. Prune `tests/test_cli.py` to what survives and make it green.
- [ ] Bench gate: for each of the six tasks in `nurb-benchmarks/tasks`, run one Claude Code trial with `nurb mcp` attached, `nurb checkout` the result, and score it with the benchmarks scorer. Record scores, durations and transcript paths in PROGRESS.md. Ask before spending the trials.
- [ ] File an issue in `nurb-benchmarks` describing the harness change (`--mcp-config`, checkout before scoring) with the exact commands used.
- [ ] Update the six bench task instructions' references to files only if the scorer needs it; the tasks themselves do not change.

### Success Criteria

- `nurb import examples/notch` followed by `nurb checkout <id> /tmp/out` produces a folder where `diff -r examples/notch /tmp/out` reports no differences in `parts/`, `measurements.toml` or `printer.toml`.
- `uv run pytest` passes with no skipped tests that mention `server.py`, `edit.py`, `nurb dev` or `nurb new`.
- `nurb check --strict` in a checked-out `examples/notch` exits 0.
- Each of the six bench tasks scores above the gate (builds one solid) in one trial through the tool path, with the scorer output recorded in PROGRESS.md.

### Files Likely Affected

`src/nurb/cli.py`, `src/nurb/folder.py` (import/checkout), `tests/test_folder.py`, `tests/test_cli.py`, `docs/v2/PROGRESS.md`.


---

## Phase 6: The workbench

### Objective

`nurb serve` serves a full browser page built from `@nurb/ui`: project list, part list, viewer, params, export, findings, and a read-only transcript. Live updates over a websocket when rows change. It replaces `viewer.html` and ships in the wheel as static files.

### Rationale

This is the surface for the terminal user ("the viewer opens from `nurb serve`") and the reference composition the desktop copies. Shipping it in the wheel keeps the tool offline and the render path browser-free.

### Tasks

- [ ] `packages/workbench`: a Vite app composed from `@nurb/ui`, built to `src/nurb/static/` and added to `source-include`. The build is a `uv build` prerequisite documented in `CONTRIBUTING` and run by the publish workflow.
- [ ] Serve routes: `GET /` the workbench, `GET /api/projects`, `GET /api/projects/<id>` (parts, params, findings, measurements, spec, messages), `POST /api/parts/<id>/params` (slider values become overrides and a build), `POST /api/parts/<id>/export` (3MF, STL, STEP, GLB with tuned settings), `WS /ws` broadcasting `project`, `part`, `build`, `message` change events with ids.
- [ ] Slider apply writes the new defaults back through the same AST edit `edit_part_source` uses, as a new revision with `parent_id`.
- [ ] Anything cached from a build (stress, slice estimate) clears on rebuild, per the doctrine in CLAUDE.md.
- [ ] Remove `src/nurb/viewer.html` and `src/nurb/vendor/three`; update the README's offline note to point at the bundled workbench.
- [ ] Deep links: `/?project=<id>&part=<name>` selects on load.

### Success Criteria

- Opening the serve URL in a browser with `examples/notch` imported shows the project and its parts, captured in `docs/v2/screenshots/phase-6-workbench.png`.
- Dragging a slider triggers a build and the viewer swaps geometry without the camera moving (screenshots before and after with matching camera readout).
- `write_part_source` from an MCP client updates the open workbench page within two seconds without a reload.
- Export of a 3MF from the page downloads a file that `nurb slice` accepts.
- `uv build` produces a wheel that contains `nurb/static/index.html` and no `viewer.html`.

### Files Likely Affected

`packages/workbench/**`, `src/nurb/serve.py`, `src/nurb/static/` (built), `src/nurb/viewer.html` (deleted), `src/nurb/vendor/` (deleted), `pyproject.toml`, `.github/workflows/publish.yml`, `tests/test_serve.py`.


---

## Phase 7: Desktop shell on `@nurb/ui`

### Objective

The desktop app spawns `nurb serve`, reads projects and parts as rows, and renders the viewer, params, export and findings in-process from `@nurb/ui`. Folder projects become Import. Settings keeps the agents section.

### Rationale

The app is the primary UI. This phase moves it onto the new foundation before chat, so the viewer and rail are verified on their own.

### Tasks

- [ ] `supervisor.rs`: spawn `nurb serve --port <n>`; readiness from `serve.json` or stdout URL as today; one respawn on a port race.
- [ ] Rust command surface: drop `add_project`, `add_projects_from_folder`, `list_parts` readdir merge, `create_part`, `delete_part`; add `import_folder(path)` (calls the serve's import endpoint), keep `list_projects` as a thin HTTP proxy or let TS call the serve directly with the token from `serve.json`. Prefer TS fetch; Rust stays for the window, provisioning, sessions and the agents.
- [ ] `desktop/src`: rebuild `App.tsx` on `@nurb/ui` tokens, `Icon`, `ViewerIsland`, `ParamsPanel`, `ExportMenu`. Rail lists projects and parts from `/api/projects` over the websocket, no polling. Selection is local state, no `nurb:part` messages. `partMessages.ts`, `partRecovery.ts`, `layout.ts` are deleted or rewritten against rows.
- [ ] Settings: agents section as today; a nurb.app section rendered signed-out with the copy "Sign in to publish parts and back up projects" and a disabled button until Phase 11.
- [ ] `nurb://open?src=https://nurb.app/p/<slug>`: the Tauri deep-link plugin registers the scheme; `get_public_part` fetches source, measurements and card from the shipped public page contract into a new local project. This is the one nurb.app request a signed-out app may make, and only when the user opens such a link.
- [ ] Embed-mode labels are gone (no iframe), so audit every string for `.py`/`.md` mentions and replace with hobbyist wording.
- [ ] `./node_modules/.bin/tsc --noEmit` and `npm test` in `desktop/` green; the UI test hook on loopback port 7399 still drives the app.

### Success Criteria

- Launching the dev app with no projects shows an empty state offering "New project" and "Import folder", captured in `docs/v2/screenshots/phase-7-empty.png`.
- Importing `examples/notch` from the app lists its parts in the rail within five seconds, captured in `docs/v2/screenshots/phase-7-rail.png`.
- Dragging a slider in the app rebuilds and the viewer keeps its camera (readout unchanged in two screenshots).
- `grep -r "postMessage\|nurb:part\|nurb:saved" desktop/src` returns nothing.
- `npm test` and `tsc --noEmit` in `desktop/` exit 0.
- Opening a `nurb://open?src=...` link for a published part with the app closed launches it with a new project containing that part's source and measurements.

### Files Likely Affected

`desktop/src/**`, `desktop/src-tauri/src/lib.rs`, `desktop/src-tauri/src/supervisor.rs`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`, `desktop/vite.config.ts`, `desktop/package.json`, `desktop/tests/*.test.ts`, `src/nurb/mcp_server.py`, `docs/v2/screenshots/`.


---

## Phase 8: The Claude driver

### Objective

The app's Claude path runs the unmodified `claude` binary directly with `--output-format stream-json --input-format stream-json --mcp-config` pointing at `nurb mcp` (HTTP entry to the serve). Its stream renders in the chat column as prose, tool steps and build cards, and every turn is stored in `messages`.

### Rationale

This is the only fully permitted subscription path, and the ACP Claude adapter drops session-scoped MCP servers (claude-agent-acp #883). The primary agent cannot ride an adapter with an open MCP bug.

### Tasks

- [ ] `desktop/src-tauri/src/claude.rs`: spawn `claude` from PATH (never bundled, never modified, never `--hide-claude-auth`), with `--permission-mode` defaulting to accept nurb's own tools (`--allowedTools "mcp__nurb__*"`), `--mcp-config` as a JSON string, `-p` with stream-json in both directions, resume by session id. Map `stream-json` events onto the existing `ChatEvent` channel (`agent_text`, `tool_call`, `tool_call_update`, `session_error`); permission requests via `--permission-prompt-tool` only if a non-nurb tool is requested.
- [ ] Sign-in state: detect a missing login from the first stream event and show Anthropic's own instruction (`claude` in a terminal) rather than any in-app login. Never touch credentials.
- [ ] Chat column on `@nurb/ui`: `AssistantMarkdown` for prose, `ToolStepCard` per tool call (verb, object, elapsed), `BuildCard` for `run_build`/`write_part_source` results with the composite inline, `SpecCard`, `MeasurementCard`. No separate activity rail.
- [ ] Composer writes the user's turn to `messages` and to the process's stdin.
- [ ] Version check: require `claude` at 2.1.221 or newer for `--mcp-config` waits; older prints the upgrade instruction.
- [ ] Tests: a fake `claude` script emitting recorded stream-json exercises the mapper in `cargo test`; a TS test renders a recorded transcript.

### Success Criteria

- With `claude` signed in, asking "make a 20 mm cable clip" in the app produces a `write_part_source` tool step, a build card with the composite image, and a new part in the rail, captured in `docs/v2/screenshots/phase-8-chat.png`.
- The tool step line reads verb, object and elapsed time and is collapsed by default (screenshot).
- Killing the app mid-turn and relaunching resumes the same Claude session id with the transcript intact.
- `grep -r "hide-claude-auth" desktop/` returns nothing.
- `cargo test` in `desktop/src-tauri` passes including the fake-claude stream test.

### Files Likely Affected

`desktop/src-tauri/src/claude.rs`, `desktop/src-tauri/src/acp/events.rs`, `desktop/src-tauri/src/agents.rs`, `desktop/src-tauri/src/lib.rs`, `desktop/src/Chat.tsx`, `desktop/src/chatColumns.ts`, `desktop/tests/`, `desktop/src-tauri/tests/fixtures/`.


---

## Phase 9: MCP into ACP sessions

### Objective

Codex and Gemini sessions receive the nurb MCP server in `session/new`; the app verifies the tools actually reached the model; adapters that cannot take a server get a materialized working folder captured back as revisions.

### Rationale

Codex and Gemini honor `mcpServers` today; the Claude adapter does not, and the Cursor adapter once silently ignored it. Gating on advertised capability and verifying after the fact is the only safe way to ship.

### Tasks

- [ ] Bump `@agentclientprotocol/codex-acp` to 1.11.0 in `desktop/adapter-runtime`.
- [ ] `acp.rs`: read `agentCapabilities.mcpCapabilities` from `initialize`; pass an HTTP entry (`type: "http"`, serve URL, token header) when `http` is true, else an untagged stdio entry with an absolute path to `nurb mcp` (never `type: "stdio"` while adapters speak v1). Handle the v2 shape (`agentCapabilities.session.mcp`) behind the same function.
- [ ] Verification: after `session/new`, send a hidden first prompt that lists tools, or inspect the adapter's advertised tool list where the protocol offers it; if `mcp__nurb__*` is absent, mark the session "tools unavailable" and switch to the folder fallback.
- [ ] Folder fallback: `nurb checkout` the project into a session folder, point the ACP session's `cwd` there, and on each `tool_call_update` that writes a part file, capture it back as a revision (nurb-app's `capture.rb` pattern). Used only when tools are unavailable.
- [ ] Spike, timeboxed to one hour: `claude-agent-acp` 0.76.0 with an HTTP entry. Record in PROGRESS.md whether `mcp__nurb__*` reached the model. Either way the Claude default stays the Phase 8 driver; the adapter remains selectable.
- [ ] Chat column renders ACP `tool_call` events with the same `ToolStepCard` as the driver.

### Success Criteria

- A Codex session in the app lists `mcp__nurb__write_part_source` among its tools (adapter log or first-turn verification recorded in PROGRESS.md).
- A Gemini session builds a part through `run_build` with the tool step visible in the chat column (screenshot).
- Forcing capability detection to report no MCP support makes the session use the folder fallback, and a part file the agent writes becomes a new `part_revisions` row with `parent_id` set.
- `desktop/adapter-runtime/package.json` pins codex-acp at 1.11.0.
- The Claude adapter spike's outcome is recorded in PROGRESS.md with the adapter version and the exact `mcpServers` entry used.

### Files Likely Affected

`desktop/src-tauri/src/acp.rs`, `desktop/src-tauri/src/acp/events.rs`, `desktop/src-tauri/src/sessions.rs`, `desktop/adapter-runtime/package.json`, `desktop/src/Chat.tsx`, `src/nurb/folder.py`.


---

## Phase 10: Skill, docs, and the 1.0.0a1 release

### Objective

The shipped skill shrinks to "add the nurb MCP server, call `read_guide` first"; the docs, site and README describe v2; `nurb 1.0.0a1` ships to PyPI with the desktop app in one release.

### Rationale

Ladder 3 ships as a published version (ladder 4 shipped in Phase 2). nurb-app cannot start ladder 8 until the wheel exists on PyPI.

### Tasks

- [ ] `src/nurb/skill.md` and `skills/nurb/SKILL.md`: the MCP instruction, the `read_guide` first rule, the workbench URL habit. `nurb skill --sync` and `nurb update` unchanged in shape.
- [ ] `.github/workflows/publish.yml`: build the workbench before `uv build`; keep the tag, npm and GitHub release steps. `desktop/scripts/release.sh` unchanged except the version mapping from Phase 2.
- [ ] README, `site/`, and the changelog entry via the `changelog` skill: what changed for a v1 user (`nurb import`), the dependency note, the offline note.
- [ ] CONTRACT §5 status: ladder 3 shipped with the version; ladder 5's desktop half noted as landed on main.
- [ ] Run the `/release` skill for `1.0.0a1`.

### Success Criteria

- `pip install nurb==1.0.0a1` in a clean venv followed by `nurb mcp` starts a server that Claude Code lists as connected.
- `uv run pytest` passes including the version agreement tests across all four version strings.
- The installed skill file contains the string `read_guide` and no mention of `nurb dev`.
- CONTRACT §5 shows ladders 3 and 4 as shipped with the exact versions.

### Files Likely Affected

`src/nurb/skill.md`, `skills/nurb/SKILL.md`, `tests/test_cli.py`, `.github/workflows/publish.yml`, `README.md`, `site/**`, `docs/v2/CONTRACT.md`.


---

## Phase 11: The nurb.app bridge

**Awaits ladders 1 and 2** (nurb-app's OAuth server with the `nurb-desktop` client, and the sync API). Check `https://nurb.app/.well-known/oauth-authorization-server` and the sync endpoints before starting and stop with "blocked on ladder 1" or "blocked on ladder 2" if either is missing; no stubs.

### Objective

Settings gains a nurb.app section with browser sign-in; Publish per part; Back up per project with one-way push, presigned uploads for GLBs and thumbnails, and explicit Pull. Local is the truth and a parent mismatch surfaces as a conflict. Signed out means zero requests.

### Rationale

The only optional network feature. It is last because it depends on another repo, and because everything before it must work with no account.

### Tasks

- [ ] `src/nurb/cloud.py`: OAuth 2.1 PKCE against `https://nurb.app/.well-known/oauth-authorization-server`, loopback redirect on a free port, public client `nurb-desktop`, scopes `sync` and `mcp`, rotating refresh tokens. Token storage through the macOS `security` CLI, a 0600 file elsewhere; no new dependency.
- [ ] `nurb login` / `nurb logout` and the serve endpoints the app calls for the same.
- [ ] Push: `PUT /sync/projects/:local_id` with parts (source, card, `parent_revision_id`, `note`), measurements (value, `how`, `provisional`) and printer profile; for each entry in the response's `needs_upload`, `POST /sync/uploads` for presigned R2 URLs by content hash, upload the GLB and thumbnail, then `POST /sync/builds` with hash, stats and findings. A 409 carries the hosted head and shows as a conflict on the project row with the choice to keep local or pull. `GET /sync/projects/:id/changes?since=` for Pull.
- [ ] Publish: a visibility picker plus copy link on the part; `publish_part` tool returns the public URL. The local tool returns a clear error when signed out.
- [ ] Settings copy: signed-out "Sign in to publish parts and back up projects"; signed-in "Signed in as @handle · Disconnect".
- [ ] Network test: a signed-out serve and app make zero requests to `nurb.app` across a full session (assert with a recording HTTP transport).

### Success Criteria

- With no token stored, a full app session (launch, import, build, export) records zero requests to any `nurb.app` host.
- `nurb login` completes in a browser and the serve's `/api/account` returns the handle.
- Publishing a part returns a URL under `https://nurb.app/p/` that renders the part with sliders.
- Turning on Back up pushes the project and the row shows parity; editing a part locally and pushing again shows the new revision on nurb.app.
- Pushing a project whose parent revision no longer matches the hosted head shows a conflict on the project row and writes nothing to nurb.app.
- Turning on Back up for a project with two built parts results in two GLB uploads to presigned URLs followed by two `POST /sync/builds` calls (recorded by the test transport).

### Files Likely Affected

`src/nurb/cloud.py`, `src/nurb/serve.py`, `src/nurb/mcp_server.py`, `src/nurb/cli.py`, `desktop/src/Settings.tsx`, `desktop/src/App.tsx`, `desktop/src-tauri/src/lib.rs`, `tests/test_cloud.py`.


---

## Phase 12: The relay client

**Awaits ladder 6** (nurb-app's relay door at `/mcp`, connector OAuth, and the `DesktopChannel` envelope in nurb-app `docs/ops/relay.md`). Check that document and the endpoint before starting and stop with "blocked on ladder 6" if either is missing; no stubs.

### Objective

While the app runs and the user is signed in, it holds one authenticated WebSocket to nurb.app and answers MCP JSON-RPC requests forwarded from claude.ai or ChatGPT by handing them to the local `nurb serve` `/mcp` endpoint. nurb.app stores nothing; the user's phone talks to their own nurb instance.

### Rationale

nurb.app runs no tools and no model. The relay is how a connector user reaches the engine without nurb.app ever running it, and it reuses the local server unchanged, so the contract stays written once.

### Tasks

- [ ] `src/nurb/relay.py`: connect to the `DesktopChannel` with the stored token, reconnect with backoff, answer each forwarded request by POSTing it to the local `/mcp` and returning the response correlated by id. Enforce the envelope limits (240 s, 150,000 characters) by returning an MCP error rather than a truncated result.
- [ ] Only one relay per account: a second running app for the same user is told the channel is taken and shows it in Settings.
- [ ] Settings: "Reachable from claude.ai and ChatGPT" status line with the connection state; disconnect stops the relay. Signed out or offline means no socket.
- [ ] Tests: a fake channel server forwards recorded `tools/list` and `tools/call` frames and the relay's answers equal a direct call to `/mcp`.
- [ ] Log each forwarded call as a `messages` row so the app's transcript shows what the connector did.

### Success Criteria

- With the app signed in and open, a `tools/list` forwarded through the fake channel returns the same list as a direct `POST /mcp` on the local port.
- A forwarded `run_build` whose result exceeds 150,000 characters returns an MCP error naming the limit and no truncated payload.
- Killing the channel server and restarting it results in the app reconnecting within thirty seconds without user action.
- With the app signed out, no WebSocket to any `nurb.app` host is opened during a full session (recording transport).
- A forwarded `write_part_source` appears in the app's transcript as a tool step attributed to the connector.

### Files Likely Affected

`src/nurb/relay.py`, `src/nurb/serve.py`, `src/nurb/cloud.py`, `desktop/src/Settings.tsx`, `desktop/src-tauri/src/lib.rs`, `tests/test_relay.py`.

---

## Post-Implementation

- [ ] Documentation: `nurb rules`, `nurb api`, the site's guide pages, and CLAUDE.md's layout table rewritten for v2 modules.
- [ ] Testing: the six bench tasks re-run through the tool path on the released `1.0.0a1`, results submitted to nurb-benchmarks under the new harness identity.
- [ ] Performance: build latency from `write_part_source` to result on the notch shelf, target under the v1 save-to-viewer loop plus the composite render; record the number.
- [ ] Retire v1 for real: close v1 issues that no longer apply, release note for `nurb import`.

## Notes

- **One port, one framework.** Starlette and uvicorn own the workbench HTTP, the websocket and the MCP endpoint. `http.server` and `watchdog` are gone; `websockets` stays because uvicorn uses it for the websocket route. The Python MCP SDK requires the ASGI stack anyway, so there is no cheaper shape.
- **`nurb mcp` never opens the database.** It is a stdio proxy to the serving process and autostarts it. This is what keeps one writer.
- **Database location** follows the existing `config.toml` convention (`checks.global_file()`, honors `XDG_CONFIG_HOME`), overridable with `NURB_HOME`. One convention, no platform-dirs dependency.
- **Composite size is a measured gate, not a guess.** Claude Code counts image bytes against its 25,000-token MCP output cap, and the `anthropic/maxResultSizeChars` annotation covers only text. If the 2x2 cannot stay legible under 80,000 base64 characters, build results carry the resource link only and `look` carries the image; that is a CONTRACT bump.
- **`nurb render` drops the browser.** The rasterizer ported from nurb-app renders every view offline, so the playwright extra goes away.
- **Command names.** `serve`, `mcp`, `import`, `checkout` are guessable. `dev`, `new`, `launcher` are removed; the workbench and the app create projects.
- **Never `--hide-claude-auth`, never broker login, never modify the binary.** Those three keep the Claude driver inside Anthropic's carve-out.
- **`tools.json` is this repo's file and the only implementation is the local server.** nurb.app relays to it and never serves tools. A change to a tool name or schema is a CONTRACT §2 bump first.
- **No `check_messages`.** Removed from the contract on 2026-09-13. The workbench transcript is read-only; conversation happens in the app's chat column or the connector's own chat.
- **The Claude adapter is not dead.** It stays selectable and Phase 9 records whether HTTP `mcpServers` reaches the model on 0.76.0. When claude-agent-acp #883 closes, the adapter becomes an option again without code churn.
- **Ask before the bench trials** (Phase 3). They spend the subscription.
