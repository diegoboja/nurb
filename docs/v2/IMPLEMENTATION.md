# nurb v2 Implementation Plan

## Overview

v2 resets the product layer and keeps the engine and the Tauri core. SQLite becomes the truth, agents work through MCP tools served by `nurb serve`, the viewer and app UI are rebuilt on one React package (`@nurb/ui`), and the desktop app drives the unmodified `claude` binary directly for the Claude path while Codex and Gemini stay on ACP. An optional bridge to nurb.app (sign in, Publish, Back up) and the relay client close the plan and are blocked until nurb-app ships its side. Decisions and evidence are in `docs/v2/RESEARCH.md`; the cross-repo contract is `docs/v2/CONTRACT.md`.

This is the second cut of the plan (2026-09-13). The first cut opened with two npm package phases and packed the whole Python foundation into one phase. This cut keeps the same scope and every decision, and changes two things: the Python spine comes first, so Claude Code builds a part into rows at the end of Phase 2 before any UI is extracted, and the phases are sized to a half day each with something to run or see at the end of every one.

The handoff ladder in CONTRACT §5 orders the tail of this plan. nurb.app runs no tools and no model: it ships identity, sync, public pages and a relay. This repo ships the wheel with `tools.json` (ladder 3), the desktop rebuilt with the bridge (ladder 5, awaits nurb-app's OAuth and sync), and the relay client (ladder 7, awaits nurb-app's relay door). A phase that consumes another repo's artifact checks the registry or the contract before starting and stops with "blocked on ladder N" if it is missing; it never stubs or vendors the artifact.

Facts established by the inventory on 2026-09-13, so no phase rediscovers them:

- The complete nurb-app checkout is `~/Development/nurb-app` (the Conductor worktrees under `~/conductor/workspaces/nurb-app/` are partial). Its `web/app/frontend/components/` holds `viewer/ViewerIsland.tsx` (542 lines), `viewer/ParamsPanel.tsx` (532), `viewer/ExportMenu.tsx` (268), `viewer/paramsState.ts` (130), `chat/BuildCard.tsx` (223), `chat/SpecCard.tsx` (113), `chat/MeasurementCard.tsx` (77), `chat/assistantMarkdownPolicy.ts`, `ui/Icon.tsx` (234); tokens are the `@theme` block in `entrypoints/application.css` (267). Types live in `hooks/useConversation.ts` (194). `ToolStepCard` and `AssistantMarkdown` do not exist as components; v2 creates them.
- nurb-app's tool layer is ten Ruby `DEFINITION` hashes under `web/app/services/agents/tools/`: `amend_spec`, `edit_part_source`, `find_photos`, `look`, `pin_spec`, `read_findings`, `read_measurements`, `record_measurement`, `run_build`, `write_part_source`. The six other tools in CONTRACT §2 (`list_projects`, `get_project`, `create_project`, `read_guide`, `publish_part`, `get_public_part`) are new to this repo. The build sequence to mirror is `engine/src/nurb/hosted.py` (246 lines); the materializer is `web/app/services/engine/materializer.rb` (96); the rasterizer is `engine/src/nurb/thumbnail.py` (353); spec validation is `web/app/services/agents/operator.rb` (694); the edit-capture pattern is `web/app/services/engine/capture.rb` (37).
- The "2x2 composite" is today four separate 640x400 PNGs stitched in Ruby; v2 composites in the wheel.
- `check_messages` was removed from the contract on 2026-09-13. No tool result carries workbench messages; the workbench transcript is read-only.
- `desktop/adapter-runtime` pins `claude-agent-acp` 0.74.0, `codex-acp` 1.10.0, `gemini-cli` 0.55.1. `desktop/package.json` has no `three` dependency; the viewer is the iframe. There is no root `package.json`.
- nurb-app's `docs/ops/relay.md` does not exist yet. Phase 16 is blocked until it does.
- `examples/notch` has 13 parts and a `measurements.toml` but no `printer.toml`; `examples/demo` has one part and neither file.
- v1's product layer to replace: `server.py` (1618), `viewer.html` (2902), `cli.py` (1476), `edit.py` (273), `render.py` (214), `crash.py` (111), `vendor/` (~7.7k), plus the `measurements.py` resolution walk and `skill.md`/`agents.md`. Tests coupled to it: `test_server.py` (1462), `test_cli.py` (1131), `test_crash.py`, `test_edit.py`, `test_render.py`, `test_viewer_print.py`, `test_params.py`, and parts of `test_assembly.py`, `test_card.py`, `test_probe.py`, `test_compare.py`, `test_mesh.py`, `test_api.py`.

## Prerequisites

- `uv` and Python 3.13, Node 22, Rust toolchain for the desktop; `claude` CLI at v2.1.221 or newer signed into a subscription (needed for `--mcp-config` waits and the bench gate).
- Read access to `~/Development/nurb-app` for the one-time `@nurb/ui` extraction (Phases 6 to 8) and the Python ports (Phases 1, 3, 4). Its `docs/core/PROGRESS.md` tail holds learnings to mine before each port.
- `v0.26.0` is tagged as the last v1; v2 lands on `main` and ships as `1.0.0a1`. No `legacy/` folder; git history is the reference. The publish workflow only fires on a version change, so `main` can carry an unreleased half-built v2 between phases.

## Phase Summary

| # | Phase | Ladder | What the user can do after it |
|---|---|---|---|
| 1 | Database, materializer, and the folder round trip | 3 | `nurb import examples/notch` makes rows; `nurb checkout` writes the same folder back; a build runs from rows |
| 2 | The tool contract and the serving process | 3 | Add `nurb mcp` to Claude Code and have it create a project and build a part into rows |
| 3 | The render | 3 | Build results carry one 2x2 image; `nurb render` works with no browser |
| 4 | Guide, spec, photos, and the schema variant | 3 | Claude reads the doctrine first, pins a spec, and sees reference photos |
| 5 | The bench gate and the folder CLI | 3 | Six bench tasks pass through the tool path; engine commands still work on a folder |
| 6 | `@nurb/ui`: the package and the cards | — | Browse tokens, icons, cards, transcript pieces in a gallery page |
| 7 | ViewerIsland | 4 | Orbit a real GLB with findings glow, section and ghost in React |
| 8 | Panels and the release plumbing | — | Drag params and export in the gallery; the five version strings agree under one mapping |
| 9 | The workbench, read side | 3 | Open `localhost:7373`, browse projects and parts, watch builds land live, read the transcript |
| 10 | The workbench, write side, and retiring v1 | 3 | Drag sliders, apply, export from the page; `viewer.html`, `nurb dev` and `server.py` are gone |
| 11 | Desktop shell on `@nurb/ui` | 5 | Launch the app, see projects as rows, use the viewer in-process, open a public part by link |
| 12 | The Claude driver | 5 | Chat with Claude Code inside the app; it edits parts through tools |
| 13 | MCP into ACP sessions | 5 | Codex and Gemini use tools; the folder fallback covers an adapter without MCP |
| 14 | App-only: delete the CLI, Connect panel, the 1.0.0a1 release | — | Download the app from the GitHub release; connect Claude Code to it from Settings; there is no `nurb` command |
| 15 | The nurb.app bridge | 5 (awaits 1, 2) | Sign in, Publish, Back up, Pull |
| 16 | The relay client | 7 (awaits 6) | Use your nurb from claude.ai or ChatGPT while the app is open |

---

## Phase 1: Database, materializer, and the folder round trip

### Objective

One SQLite database holds projects, parts, revisions, build runs, measurements, messages and pinned specs. A project materializes to a scratch folder the unchanged engine can build, and a v1 folder imports to rows and checks out again byte for byte.

### Rationale

Everything on the Python side stands on the rows and the materializer. Doing the folder round trip in the same phase gives a fixture (`examples/notch` as rows) that every later phase uses, and proves the engine and `measured()` stay untouched before a single tool exists.

### Tasks

- [ ] `src/nurb/db.py`: schema and migrations in plain `sqlite3`, WAL mode, UUID text ids. Tables: `projects` (`name`, `printer`, `created_at`), `parts` (`project_id`, `name`, `kind`, `current_revision_id`, unique by project/name/kind so root and `parts/` modules may share a basename; part names match `^[a-z][a-z0-9_]*$`), `part_revisions` (`part_id`, `source`, `card_md`, `params`, `parent_id`, `note`, `created_at`), `build_runs` (`revision_id`, `status`, `error`, `findings`, `inspect_report`, `stats`, `params`, `overrides`, `glb` blob, `render` blob, `started_at`, `finished_at`), `measurements` (`project_id`, `name`, `value`, `unit`, `how`, `provisional`, `value_changed_at`), `messages` (`project_id`, `role`, `content`, `payload`, `sequence_number`), `pinned_specs` (`project_id`, `spec`, `created_at`). Database path from `NURB_HOME`, default next to `config.toml` under the existing `checks.global_file()` convention.
- [ ] `src/nurb/materialize.py`: write `<scratch>/parts/<name>.py`, `<scratch>/parts/<name>.md` when a card exists, `<scratch>/measurements.toml` (float values, the stored unit unchanged, quoted measurement keys, `how`, `provisional` only when true), `<scratch>/printer.toml` from the project's printer choice, root shared modules with `kind = "module"`, and `parts/_*.py` shared modules with `kind = "parts_module"`. A non-mm imported measurement stays non-mm so `measured()` refuses it instead of silently relabeling its value. Snapshot, not overlay: clear `parts/*` first. Mirror nurb-app's `materializer.rb`.
- [ ] `src/nurb/engine_run.py`: one function `run_build(scratch, part, overrides, profile)` mirroring `hosted.py`: name guard, `builder.build`, `checks.printer` plus `checks.from_card` (a bad card is a `card` finding, never hides geometry), `builder.to_glb`, `builder.stats`, `checks.run`, `probe.finding_faces`, `probe.report` (limit 12, a probe failure becomes one line). Returns findings, stats, inspect lines, GLB bytes, and a traceback trimmed to the part's own file on error. Stores the result as a `build_runs` row.
- [ ] `src/nurb/folder.py`: `import_folder(dir)` creates a project, parts (one revision each, card from the `.md`), root modules with `kind = "module"`, `parts/_*.py` modules with `kind = "parts_module"`, measurements with their original unit, `how`, and `provisional` from the TOML, and the printer from `printer.toml` when present. `checkout(project_id, dir)` writes the v1 folder shape back.
- [ ] `nurb import <dir>` and `nurb checkout <project> <dir>` in `cli.py`. `nurb import` prints the project id and the part count.
- [ ] Tests: `tests/test_db.py` (schema, WAL, migration idempotence), `tests/test_folder.py` (round trip on `examples/notch` and `examples/demo`), `tests/test_engine_run.py` (a notch part builds from rows through the materializer; a raising part stores `status = "error"` with the trimmed traceback).

### Success Criteria

- `uv run pytest tests/test_examples.py tests/test_rules.py tests/test_notch_fit.py` passes unchanged.
- `nurb import examples/notch` prints one project id and a part count equal to the number of files in `examples/notch/parts/*.py` that do not start with an underscore.
- `nurb import examples/notch` followed by `nurb checkout <id> <dir>` produces a folder where `diff -r examples/notch/parts <dir>/parts` reports no differences.
- After that checkout, `tomllib` parses of `examples/notch/measurements.toml` and `<dir>/measurements.toml` are equal (the prose comments in the source file are not rows, so the comparison is semantic).
- Running `import_folder` twice on the same directory creates two distinct projects rather than mutating the first (test asserts two ids).
- `run_build` on an imported notch part stores a `build_runs` row whose `glb` blob is non-empty and whose `status` is `ok`.
- `run_build` on a part that raises inside build123d stores a `build_runs` row whose `error` text starts at a frame in the part's own file.

### Files Likely Affected

`src/nurb/db.py`, `src/nurb/materialize.py`, `src/nurb/engine_run.py`, `src/nurb/folder.py`, `src/nurb/cli.py`, `tests/test_db.py`, `tests/test_folder.py`, `tests/test_engine_run.py`.

---

## Phase 2: The tool contract and the serving process

### Objective

`nurb serve` owns the database and serves the MCP tool contract from `tools.json` over Streamable HTTP; `nurb mcp` is a stdio proxy to it. Claude Code, with `claude mcp add nurb -- nurb mcp`, can create a project, write a part, and get findings back.

### Rationale

This is the spine. Shipping the MCP path against a real agent before any UI exists is the first proof of the tool loop, and the relay (Phase 16) forwards to this same server, so the contract is written once here. One process owns the database, and `nurb mcp` never opens the file.

### Tasks

- [ ] Add `mcp` to `pyproject.toml` dependencies; keep `watchdog` and `websockets` until Phase 10. Record the transitive cost of the MCP SDK (measure it: package count and installed size in a fresh venv) in PROGRESS.md and the README's dependency note.
- [ ] `src/nurb/tools.json`: every tool in CONTRACT §2 with `name`, `title`, `description`, full JSON Schema `inputSchema`, `annotations` (`readOnlyHint`, `destructiveHint`), and `_meta["anthropic/maxResultSizeChars"]` where results can be large. Every write tool takes `note`. Start from nurb-app's ten Ruby `DEFINITION` hashes for the tools they cover; write the six new ones fresh. Add it to `source-include`.
- [ ] `src/nurb/mcp_server.py`: low-level `mcp.server.Server` with `list_tools` loading `tools.json` via `Tool.model_validate`, `call_tool` dispatching by name, `jsonschema` validation of arguments in the dispatcher returning `isError` results (never a protocol error). Implement `list_projects`, `get_project`, `create_project` (placeholder names drawn from a word list, never "Untitled"), `read_measurements`, `record_measurement` (returns previous value and stale parts), `write_part_source`, `edit_part_source` (an exact-text replace of one unique snippet, mirroring nurb-app; the AST keyword edit in `edit.py` is the slider path and stays for Phase 10), `run_build`, `read_findings`. `get_project` accepts an optional exact part name and source offset/limit so an agent can recover any source omitted by the full-project result ceiling. Build tools return findings, stats, inspect lines and a `ResourceLink` to the GLB; Phase 3 swaps the link for the render and adds the image. Tools not yet implemented return an `isError` result saying which phase adds them.
- [ ] `src/nurb/serve.py`: Starlette app run by uvicorn on one port (7373 or next free), mounting the MCP app at `/mcp` (stateless, JSON responses), `GET /glb/<part>.glb` from the latest successful run, `GET /api/state` (projects and parts, for smoke testing until Phase 9). Writes `serve.json` (port, pid, token) under `NURB_HOME`. A file lock guards the database: a second `nurb serve` exits with the running one's live URL on stdout, never a dead predecessor's stale publication.
- [ ] `nurb mcp`: a stdio proxy that reads `serve.json`, starts `nurb serve` detached when nothing is running, waits up to 90 seconds for cold installed-wheel readiness, and forwards every MCP request to `/mcp` with the token. Loopback health and MCP traffic ignore ambient proxy variables.
- [ ] Contract test: an in-process `mcp.client` session diffs `tools/list` (dumped `by_alias`, `exclude_none`, `mode="json"`) against `tools.json` with an exact equality assertion.
- [ ] Every write tool appends a `messages` row (role `assistant`, the `note` as content, the tool name and result summary as payload).
- [ ] Update `docs/v2/CONTRACT.md` §5: ladder 3 status "in progress".

### Success Criteria

- `uv run pytest tests/test_contract.py` passes with an exact equality assertion between the served tool list and `src/nurb/tools.json`.
- Starting `nurb serve` twice leaves one process holding the database, and the second invocation exits with the first one's URL on stdout.
- Killing the `nurb serve` process and running `nurb mcp` starts a new serve and answers `tools/list` (test drives the proxy through a subprocess).
- A simulated 51-second cold start remains inside the proxy's readiness budget without making the suite wait, and ambient HTTP proxy variables cannot divert its loopback health or MCP traffic.
- In a fresh Claude Code session with `claude mcp add nurb -- nurb mcp`, `/mcp` lists the nurb server as connected with every tool name from `tools.json`.
- Calling `write_part_source` with a part that raises inside build123d returns a result whose `isError` is false and whose text includes a traceback starting in the part's own file.
- Calling `write_part_source` with an argument that violates `inputSchema` returns a result with `isError` true and a message naming the offending field.
- Calling `record_measurement` for a name a part reads returns that part in `stale_parts`.
- `GET /glb/<part>.glb` on the serve port returns the GLB from the part's latest successful build run.
- `create_project` with no name returns a project whose name is not "Untitled" and is not empty.
- After a full-project result omits source, `get_project` with `part_name`, `source_offset`, and `source_limit` can retrieve the complete source across bounded calls.

### Files Likely Affected

`pyproject.toml`, `src/nurb/tools.json`, `src/nurb/mcp_server.py`, `src/nurb/serve.py`, `src/nurb/cli.py`, `src/nurb/edit.py`, `tests/test_contract.py`, `tests/test_tools.py`, `tests/test_serve.py`, `docs/v2/CONTRACT.md`, `README.md`.

---

## Phase 3: The render

### Objective

Build results carry one composite 2x2 render produced inside the wheel with no browser, `look` returns it on demand, full-size renders are MCP resources, and `nurb render` uses the same rasterizer.

### Rationale

Seeing the part is what made the file-based loop work; the tool loop needs it before an agent can be trusted on real prompts. Putting the rasterizer in the wheel removes the playwright extra and keeps renders offline.

### Tasks

- [x] Port nurb-app's `engine/src/nurb/thumbnail.py` into `src/nurb/raster.py`: numpy painter's-order rasterizer, the four views (`iso`, `back`, `top`, `under`), the five-tone palette, 2x supersample. Encode PNG with `zlib` and `struct`, no Pillow. numpy is already transitive through build123d.
- [x] `composite(glb_bytes)`: one 2x2 PNG with view captions, sized to stay under 80,000 base64 characters. Measure on the notch parts and the bench fixtures; record the sizes in PROGRESS.md. If a legible composite cannot stay under the ceiling, build results carry the resource link only and `look` carries the image, and CONTRACT §2 is bumped first.
- [x] `write_part_source`, `edit_part_source`, `run_build` return exactly one `ImageContent` (the composite) plus the `ResourceLink`; `look` returns the same for the latest run. Store the composite in `build_runs.render`.
- [x] MCP resources: `list_resources` and `read_resource` serve the full-size per-view renders as `BlobResourceContents` under `nurb://render/<part>/<view>`.
- [x] `nurb render [part]` writes `build/renders/<part>.png` through the rasterizer; `--section` stays as a cut through the mesh. Drop the `render` extra, `src/nurb/render.py`'s browser path, and `tests/test_render.py`'s playwright cases.

### Success Criteria

- `write_part_source` on the notch shelf returns exactly one `ImageContent` whose base64 length is under 80,000 characters.
- The same result contains exactly one `ResourceLink` whose URI resolves through `read_resource` to a PNG.
- `look` on a project with no successful build returns an `isError` result that names `run_build` as the next step.
- `nurb render` in `examples/notch` writes a PNG for every part in a venv without playwright installed.
- `grep -r playwright pyproject.toml src/` returns nothing.

### Files Likely Affected

`src/nurb/raster.py`, `src/nurb/mcp_server.py`, `src/nurb/render.py`, `src/nurb/cli.py`, `pyproject.toml`, `tests/test_raster.py`, `tests/test_tools.py`, `tests/test_render.py`, `README.md`.

---

## Phase 4: Guide, spec, photos, and the schema variant

### Objective

The remaining local tools land: `read_guide`, `pin_spec`, `amend_spec`, `find_photos`. `nurb api --anthropic` emits the stripped schema variant mechanically for nurb-app to consume.

### Rationale

`read_guide` is the first call the skill will tell every agent to make, so its size ceiling is a hard gate. Spec rules are ported, not invented, from `operator.rb`. The stripped schema is derived so it cannot drift from `tools.json`.

### Tasks

- [x] `src/nurb/guide.py`: `read_guide` assembles the condensed doctrine, the `api` vocabulary and a build123d sheet from `doctrine.md` and `api.py` at call time so it cannot drift. First line names the nurb version. A test asserts the ceiling with a character proxy (under 100,000 characters for the 25,000-token budget).
- [x] `src/nurb/spec.py`: `pin_spec` and `amend_spec` with validation and merge rules mirrored from `operator.rb` (`normalize`, `errors`, `AmendSpec.merge`); a pinned spec supersedes the prior one and `get_project` returns the current spec.
- [x] `find_photos`: up to N downscaled reference images from the project's attachments. Attachments are a new `attachments` table (`project_id`, `name`, `bytes`, `mime`) filled by the workbench and app later; `nurb import` picks up `references/*.{png,jpg}` when the folder has them.
- [x] `nurb api --anthropic`: derive the Anthropic-stripped variant of every `inputSchema` mechanically (drop `minimum`, `maximum`, `multipleOf`, `minLength`, `maxLength`, `pattern`; fold them into descriptions; `oneOf` to `anyOf`; inline `$ref`; force `additionalProperties: false`). Property test: the output contains none of the banned keywords.
- [x] `messages` rows for spec tools carry the spec diff as payload so the transcript can render a `SpecCard` later.

### Success Criteria

- `read_guide` returns text under 100,000 characters.
- The first line of `read_guide` names the version in `pyproject.toml`.
- `pin_spec` with a spec missing a required field returns validation errors naming that field and creates no `pinned_specs` row.
- `amend_spec` after `pin_spec` returns a spec where the amended field changed and every other field is unchanged.
- `nurb api --anthropic` output contains no `pattern`, `minimum`, `maximum`, `minLength`, `maxLength`, `multipleOf` or `oneOf` keys.
- `find_photos` on a project imported from a folder with two images in `references/` returns both `ImageContent` items in one MCP result under 150,000 characters total.

### Files Likely Affected

`src/nurb/guide.py`, `src/nurb/spec.py`, `src/nurb/mcp_server.py`, `src/nurb/tools.json`, `src/nurb/db.py`, `src/nurb/folder.py`, `src/nurb/api.py`, `src/nurb/cli.py`, `tests/test_guide.py`, `tests/test_spec.py`, `tests/test_tools.py`, `tests/test_api.py`.

---

## Phase 5: The bench gate and the folder CLI

### Objective

The engine CLI keeps working on a folder unchanged, and the six benchmark tasks pass through the tool path.

### Rationale

The gate is the guard against the second-system effect: v1 is not retired (Phase 10) until the tool path scores where the file path did. Git users and the benchmark scorer both want a folder, and `nurb checkout` from Phase 1 gives it to them.

### Tasks

- [x] Engine commands (`build`, `check`, `inspect`, `scan`, `compare`, `verify`, `extract`, `card`, `diff`, `slice`, `stress`, `export`, `rules`, `api`) keep `project_root()` folder semantics with no database awareness. Prune `tests/test_cli.py` of cases that depend on `render.py`'s browser path and make it green; leave `dev`, `new`, `launcher` cases in place until Phase 10.
- [x] Bench gate: for each of the six tasks in `nurb-benchmarks/tasks`, run one Claude Code trial with `nurb mcp` attached (`--mcp-config`), `nurb checkout` the result, and score it with the benchmarks scorer. Ask before spending the trials. Record scores, durations and transcript paths in PROGRESS.md.
- [x] File an issue in `nurb-benchmarks` describing the harness change (`--mcp-config`, checkout before scoring) with the exact commands used.
- [x] Fix what the trials expose in the tools (descriptions, result shapes, guide content) and re-run only the failed tasks.

### Success Criteria

- `uv run pytest` passes with no skipped tests that mention `render.py` or playwright.
- `nurb check --strict` in a checked-out `examples/notch` exits 0.
- Each of the six bench tasks builds one solid through the tool path in one trial, with the scorer output for each recorded in PROGRESS.md.
- The nurb-benchmarks issue exists and its body contains the `--mcp-config` invocation used.

### Files Likely Affected

`src/nurb/cli.py`, `src/nurb/tools.json`, `src/nurb/guide.py`, `tests/test_cli.py`, `docs/v2/PROGRESS.md`.

---

## Phase 6: `@nurb/ui`: the package and the cards

### Objective

An npm workspace at the repo root with `packages/ui` holding the design tokens, `Icon`, `BuildCard`, `SpecCard`, `MeasurementCard`, `ToolStepCard`, `AssistantMarkdown`, and the shared types, all transport-agnostic, viewable in a gallery page.

### Rationale

This is the one-time reverse flow from nurb-app. The pure pieces (tokens, Icon, cards) give an immediately visible result and establish the workspace the viewer and panels land in next.

### Tasks

- [x] Root `package.json` with workspaces `desktop` and `packages/*`; move `desktop/` onto the workspace lockfile. `packages/ui` builds with Vite library mode, peer deps react 19 and three 0.185, TypeScript strict.
- [x] Copy from nurb-app `web/app/frontend`: the `@theme` block of `entrypoints/application.css` as `tokens.css` (fonts referenced by relative URL; Instrument Sans and JetBrains Mono ship under the OFL, Satoshi is named only because its Fontshare license forbids redistribution), `components/ui/Icon.tsx`, `components/chat/BuildCard.tsx`, `SpecCard.tsx`, `MeasurementCard.tsx`, `assistantMarkdownPolicy.ts`.
- [x] Decouple `MeasurementCard`: `onAccept`/`onEdit` callbacks instead of the Inertia `router`.
- [x] New: `ToolStepCard` (one collapsed line: verb, object, elapsed in tabular mono, chevron to expand input and output; no pulsing indicator) and `AssistantMarkdown` (react-markdown with the disallowed-elements policy). Types split out of `useConversation.ts` into `types.ts`: `Message`, `BuildEvent`, `Spec`, `Finding`, `Params`.
- [x] `packages/ui/gallery`: a Vite page rendering every component with fixture data, light only (DESIGN.md defines no dark palette), used for screenshots. Run the `design` skill's render step against it.
- [x] Vitest smoke tests: each component renders with fixture props; `tokens.css` parses; the package's public exports match CONTRACT §3 minus the three components that land in Phases 7 and 8 (the test carries the full set and marks those as pending).

### Success Criteria

- `npm run build --workspace packages/ui` succeeds.
- `grep -rl "@inertiajs\|@rails/actioncable\|@tauri-apps" packages/ui/dist` returns nothing.
- `npm test --workspace packages/ui` passes.
- The gallery renders `BuildCard` with three steps collapsed to a single "3 steps" line that expands on click, captured in `docs/v2/screenshots/phase-6-build-card.png`.
- `ToolStepCard` shows an elapsed counter in tabular figures with no pulsing indicator, captured in `docs/v2/screenshots/phase-6-tool-step.png`.
- `MeasurementCard`'s accept button calls the `onAccept` prop with the measurement name (Vitest).

### Files Likely Affected

`package.json` (root), `package-lock.json`, `packages/ui/**`, `desktop/package.json`, `docs/v2/screenshots/`.

---

## Phase 7: ViewerIsland

### Objective

`ViewerIsland` renders the part with three.js inside React: Z-up, camera persistence across rebuilds, findings glow from face triangles, section plane with cap, target ghost, assembly joints, and a bed outline from the printer profile. No iframe, no postMessage.

### Rationale

The viewer is the product's center and the source of the shell's state-duplication bugs. Porting the rendering out of `viewer.html` into a component ends the iframe seam and gives nurb-app the same viewer when it adopts the package.

### Tasks

- [x] Read `src/nurb/viewer.html` for the rendering behaviors to keep: GLB load and swap without moving the camera, `shape_id` keyed camera reset rules, finding face glow, section plane with the cap, ghost target mesh, joint nodes, bed and grid, light and dark materials. Note each in PROGRESS.md before porting. Start from nurb-app's `ViewerIsland.tsx` (542 lines) and add what v1's viewer has that it lacks.
- [x] `ViewerIsland` props: `glbUrl`, `targetUrl`, `findings`, `highlight`, `bed`, `up`, `section`, `camera`, `onCamera`. Camera state persisted by the caller through `onCamera` and the initial `camera` prop.
- [x] Keep the current raycast on click for findings; BVH picking is out of scope.
- [x] Gallery entries: a real GLB from `nurb export --formats glb` in `examples/notch`, one with findings, one sectioned, one with a ghost.
- [x] Resize handling that does not ratchet: the ResizeObserver lesson from CLAUDE.md becomes a Vitest case with an initial size mismatch.

### Success Criteria

- Swapping `glbUrl` to a rebuilt GLB with the same bounds inside one mount leaves the camera matrix unchanged (test asserts equality of all 16 elements before and after); a swap whose bounds the camera can no longer see reframes (test asserts inequality). There is no `shape_id` prop: the caller keys the mount per part and owns persistence through `camera` and `onCamera`.
- A finding with face triangles renders as a highlighted overlay visible in `docs/v2/screenshots/phase-7-finding-glow.png`.
- The section slider cuts the mesh with a capped cut face, captured in `docs/v2/screenshots/phase-7-section.png`.
- Mounting the component in a container that then shrinks by 200 px settles in one resize with no further ResizeObserver callbacks (test counts callbacks).
- `grep -rl "iframe\|postMessage" packages/ui/dist` returns nothing.

### Files Likely Affected

`packages/ui/src/viewer/ViewerIsland.tsx`, `packages/ui/src/viewer/*.ts`, `packages/ui/gallery/`, `packages/ui/package.json`, `docs/v2/screenshots/`.

---

## Phase 8: Panels and the release plumbing

### Objective

`ParamsPanel` and `ExportMenu` join the package decoupled from Inertia and ActionCable, the gallery shows the workbench composition (viewer, params, export, findings, transcript) as one page, and the release version strings agree across the wheel, the app and the package.

### Rationale

With the viewer and panels in place the package is complete per CONTRACT §3 for its two in-repo consumers, the workbench (Phase 9) and the desktop shell (Phase 11). The npm publish that this phase originally carried (ladder 4) was dropped on 2026-09-15: nurb.app keeps its own frontend, so the package is a workspace dependency and nothing more.

### Tasks

- [x] Decouple: `ParamsPanel` takes `onChange`/`onApply` callbacks and `paramsState.ts` moves with it; `ExportMenu` takes an `export(format, profile)` promise and a `status` prop instead of `useProjectChannel`.
- [x] Gallery: a "workbench" entry composing `ViewerIsland`, `ParamsPanel`, `ExportMenu`, a findings list and a transcript of `AssistantMarkdown`, `ToolStepCard`, `BuildCard`, `SpecCard`, `MeasurementCard` from fixture data. This is the reference layout Phases 9 and 11 copy.
- [x] The Vitest export-set test now asserts the full CONTRACT §3 set with nothing pending.
- [x] Release plumbing: bump `pyproject.toml` to `1.0.0a1`, `packages/ui` to `1.0.0-alpha.1`, `tauri.conf.json` to the semver form; write the PEP 440 to semver mapping once in `tests/test_cli.py`'s version agreement test. The PyPI job must not fire for `1.0.0a1` yet: gate it on the workbench static bundle existing (Phase 10) so the wheel ships in Phase 14. (The npm publish job and the `@nurb/ui` publish were part of this task until 2026-09-15; ladder 4 is dropped and Phase 14 deletes the `npm` job.)

### Success Criteria

- `ParamsPanel` calls `onApply` with the edited values when Apply is clicked (Vitest).
- `ExportMenu` shows a pending state while the `export` promise is unresolved and the download state after it resolves (Vitest).
- The gallery workbench entry is captured in `docs/v2/screenshots/phase-8-workbench-gallery.png`.
- The export-set test asserts exactly the names in CONTRACT §3 and passes.
- `uv run pytest tests/test_cli.py -k version` passes with all four version strings agreeing under the mapping.

### Files Likely Affected

`packages/ui/src/viewer/ParamsPanel.tsx`, `packages/ui/src/viewer/ExportMenu.tsx`, `packages/ui/src/viewer/paramsState.ts`, `packages/ui/gallery/`, `packages/ui/package.json`, `pyproject.toml`, `desktop/src-tauri/tauri.conf.json`, `src/nurb/skill.md`, `skills/nurb/SKILL.md`, `tests/test_cli.py`, `.github/workflows/publish.yml`, `docs/v2/CONTRACT.md`, `docs/v2/screenshots/`.

---

## Phase 9: The workbench, read side

### Objective

`nurb serve` serves a browser page built from `@nurb/ui` at `/`: project list, part list, viewer, findings, measurements, spec, and a read-only transcript, updated live over a websocket as tools change rows.

### Rationale

This is the surface for the terminal user ("the viewer opens from `nurb serve`") and the reference composition the desktop copies. Reads first so live updates are proven before the page can write.

### Tasks

- [ ] `packages/workbench`: a Vite app composed from `@nurb/ui`, built to `src/nurb/static/` and added to `source-include`. The build is a `uv build` prerequisite documented in `CONTRIBUTING.md` and run by the publish workflow.
- [ ] Serve routes: `GET /` the workbench, `GET /api/projects`, `GET /api/projects/<id>` (parts with current source, params, last build findings and stats, measurements, spec, messages), `GET /render/<part>.png`, `WS /ws` broadcasting `project`, `part`, `build`, `message` change events with ids. Remove `GET /api/state` from Phase 2.
- [ ] Deep links: `/?project=<id>&part=<name>` selects on load.
- [ ] Camera persistence across rebuilds through `ViewerIsland`'s `onCamera` and a per-part entry in `localStorage`.
- [ ] The transcript renders `messages` rows through `AssistantMarkdown`, `ToolStepCard`, `BuildCard`, `SpecCard`, `MeasurementCard` by payload kind. Read-only: no composer.

### Success Criteria

- Opening the serve URL in a browser with `examples/notch` imported shows the project and its parts, captured in `docs/v2/screenshots/phase-9-workbench.png`.
- `write_part_source` from an MCP client updates the open page's viewer within two seconds without a reload (screenshot before and after with the new geometry).
- The page's camera readout is identical in the two screenshots above.
- A `write_part_source` with a `note` appears in the page's transcript as an assistant line followed by a tool step within two seconds.
- `GET /?project=<id>&part=<name>` opens with that part selected (Playwright or manual screenshot).

### Files Likely Affected

`packages/workbench/**`, `src/nurb/serve.py`, `src/nurb/static/` (built), `pyproject.toml`, `CONTRIBUTING.md`, `tests/test_serve.py`.

---

## Phase 10: The workbench, write side, and retiring v1

### Objective

The page can drag sliders (a build with overrides), apply them (a new revision), export with tuned settings, and every cached build product clears on rebuild. `viewer.html`, `vendor/`, `server.py`, `crash.py`, `nurb dev`, `nurb new`, `nurb launcher` and `edit.py`'s on-disk path are deleted.

### Rationale

The bench gate passed in Phase 5 and the workbench now covers what `nurb dev` did, so v1's product layer can go. Deleting it here rather than earlier keeps a working viewer at every point in the plan.

### Tasks

- [ ] Routes: `POST /api/parts/<id>/params` (slider values become overrides and a build run), `POST /api/parts/<id>/apply` (writes the new defaults back through the same AST edit `edit_part_source` uses, as a new revision with `parent_id`), `POST /api/parts/<id>/export` (3MF, STL, STEP, GLB with tuned settings), `POST /api/parts/<id>/stress`, `POST /api/parts/<id>/slice`.
- [ ] Anything cached from a build (stress, slice estimate) clears on rebuild, per CLAUDE.md.
- [ ] Delete `src/nurb/viewer.html`, `src/nurb/vendor/`, `src/nurb/server.py`, `src/nurb/crash.py`, `edit.py`'s on-disk rewrite, `nurb dev`, `nurb new`, `nurb launcher`; remove `watchdog` from dependencies; update `source-include`. Port the crash-restart (an engine crash is a build error and the serve stays up), variant-matching and shape-id invariants from `tests/test_server.py` and `tests/test_crash.py` to `tests/test_serve.py` before deleting them. Prune `test_cli.py`, `test_edit.py`, `test_viewer_print.py`, `test_params.py` and the `nurb new` uses in `test_api.py`, `test_assembly.py`, `test_card.py`, `test_mesh.py` to what survives.
- [ ] README offline note points at the bundled workbench; the desktop app's `supervisor.rs` spawn line is left broken on purpose until Phase 11 and noted in PROGRESS.md.

### Success Criteria

- Dragging a slider on the page triggers a build and the viewer swaps geometry with the camera readout unchanged (two screenshots).
- Clicking Apply creates a `part_revisions` row whose `parent_id` is the prior current revision and whose source has the new default.
- Export of a 3MF from the page downloads a file that is a valid 3MF (a zip carrying `3D/3dmodel.model` that trimesh loads as a mesh) and that the installed slicer's CLI slices without error when one is installed.
- Running the stress button then rebuilding the part clears the stress result from the page (screenshot after rebuild shows no stress numbers).
- `uv build` produces a wheel that contains `nurb/workbench/index.html` (the bundle path chosen in Phase 9) and no `viewer.html`, `vendor/`, `server.py` or `crash.py`.
- `uv run pytest` passes with no test file mentioning `server.py`, `viewer.html`, `nurb dev` or `nurb new`.
- A part whose build segfaults the kernel leaves `nurb serve` running and records a `build_runs` row with `status = "error"` (ported invariant).

### Files Likely Affected

`packages/workbench/**`, `src/nurb/serve.py`, `src/nurb/edit.py`, `src/nurb/cli.py`, `src/nurb/viewer.html` (deleted), `src/nurb/vendor/` (deleted), `src/nurb/server.py` (deleted), `src/nurb/crash.py` (deleted), `pyproject.toml`, `tests/test_serve.py`, `tests/test_server.py` (deleted), `tests/test_crash.py` (deleted), `tests/test_cli.py`, `tests/test_edit.py`, `tests/test_params.py`, `tests/test_viewer_print.py`, `README.md`.

---

## Phase 11: Desktop shell on `@nurb/ui`

### Objective

The desktop app spawns `nurb serve`, reads projects and parts as rows over the websocket, and renders the viewer, params, export and findings in-process from `@nurb/ui`. Folder projects become Import. A public part opens by `nurb://open` link. Settings keeps the agents section.

### Rationale

The app is the primary UI. This phase moves it onto the new foundation before chat, so the viewer and rail are verified on their own and the state-duplication seams (`nurb:*` messages, `list_parts` polling) are gone.

### Tasks

- [x] `supervisor.rs`: spawn `nurb serve --port <n>`; readiness from `serve.json`; one respawn on a port race.
- [x] Rust command surface: drop `add_project`, `add_projects_from_folder`, the `list_parts` readdir merge, `create_part`, `delete_part`. TS fetches the serve directly with the token from `serve.json`; Rust stays for the window, provisioning, sessions and the agents.
- [x] `desktop/src`: rebuild `App.tsx` on `@nurb/ui` tokens, `Icon`, `ViewerIsland`, `ParamsPanel`, `ExportMenu`, copying the Phase 8 gallery composition. Rail lists projects and parts from `/api/projects` over the websocket, no polling. Selection is local state. Delete `partMessages.ts`, `partRecovery.ts`, `layout.ts` and their tests; rewrite `App.css` on the tokens.
- [x] Empty state offering "New project" and "Import folder"; Import calls a new `POST /api/import` on the serve with the chosen path.
- [x] Settings: agents section as today; a nurb.app section rendered signed-out with the copy "Sign in to publish parts and back up projects" and a disabled button until Phase 15.
- [x] `nurb://open?src=https://nurb.app/p/<slug>`: the Tauri deep-link plugin registers the scheme; `get_public_part` fetches source, measurements and card from the shipped public page contract into a new local project. This is the one nurb.app request a signed-out app may make, and only when the user opens such a link.
- [x] Audit every string for `.py`/`.md` mentions and replace with hobbyist wording; embed mode no longer exists.
- [x] `./node_modules/.bin/tsc --noEmit` and `npm test` in `desktop/` green; the UI test hook on loopback port 7399 still drives the app.

### Success Criteria

- Launching the dev app with no projects shows an empty state offering "New project" and "Import folder", captured in `docs/v2/screenshots/phase-11-empty.png`.
- Importing `examples/notch` from the app lists its parts in the rail within five seconds, captured in `docs/v2/screenshots/phase-11-rail.png`.
- Dragging a slider in the app rebuilds and the viewer keeps its camera (readout unchanged in two screenshots).
- `grep -r "postMessage\|nurb:part\|nurb:saved\|list_parts\|iframe" desktop/src` returns nothing.
- `npm test` in `desktop/` exits 0.
- `npm run typecheck` in `desktop/` exits 0 (`tsc --noEmit`; the binary is hoisted to the root `node_modules` by the workspace).
- Opening a `nurb://open?src=...` link for a published part with the app closed launches it with a new project containing that part's source and measurements.

### Files Likely Affected

`desktop/src/**`, `desktop/src-tauri/src/lib.rs`, `desktop/src-tauri/src/supervisor.rs`, `desktop/src-tauri/tauri.conf.json`, `desktop/src-tauri/Cargo.toml`, `desktop/vite.config.ts`, `desktop/package.json`, `desktop/tests/*.test.ts`, `src/nurb/serve.py`, `src/nurb/mcp_server.py`, `docs/v2/screenshots/`.

---

## Phase 12: The Claude driver

### Objective

The app's Claude path runs the unmodified `claude` binary directly with `--output-format stream-json --input-format stream-json --mcp-config` pointing at the serve's `/mcp`. Its stream renders in the chat column as prose, tool steps and build cards, and every turn is stored in `messages`.

### Rationale

This is the only fully permitted subscription path, and the ACP Claude adapter drops session-scoped MCP servers (claude-agent-acp #883). The primary agent cannot ride an adapter with an open MCP bug.

### Tasks

- [x] `desktop/src-tauri/src/claude.rs`: spawn `claude` from PATH (never bundled, never modified, never `--hide-claude-auth`), `--allowedTools "mcp__nurb__*"`, `--mcp-config` as a JSON string, `-p` with stream-json in both directions, resume by session id. Map `stream-json` events onto the existing `ChatEvent` channel (`agent_text`, `tool_call`, `tool_call_update`, `session_error`); permission requests via `--permission-prompt-tool` only if a non-nurb tool is requested.
- [x] Sign-in state: detect a missing login from the first stream event and show Anthropic's own instruction (`claude` in a terminal) rather than any in-app login. Never touch credentials.
- [x] Chat column on `@nurb/ui`: `AssistantMarkdown` for prose, `ToolStepCard` per tool call (verb, object, elapsed), `BuildCard` for `run_build`/`write_part_source` results with the composite inline, `SpecCard`, `MeasurementCard`. No separate activity rail. Replace `Chat.tsx`'s and `Markdown.tsx`'s rendering with the package.
- [x] Composer writes the user's turn to `messages` (through the serve) and to the process's stdin.
- [x] Version check: require `claude` at 2.1.221 or newer; older shows the upgrade instruction.
- [x] Tests: a fake `claude` script emitting recorded stream-json exercises the mapper in `cargo test`; a TS test renders a recorded transcript.

### Success Criteria

- With `claude` signed in, asking "make a 20 mm cable clip" in the app produces a `write_part_source` tool call (a `tool_call` event in the driver's log, rendered in the transcript as the build card's `BUILD <part>` step), a build card with the composite image, and a new part in the rail, captured in `docs/v2/screenshots/phase-12-chat.png` framed on that turn.
- The tool step line reads verb, object and elapsed time and is collapsed by default (screenshot).
- Killing the app mid-turn and relaunching resumes the same Claude session id with the transcript intact.
- `grep -r "hide-claude-auth" desktop/` returns nothing.
- `cargo test` in `desktop/src-tauri` passes including the fake-claude stream test.
- With `claude` signed out, the chat column shows the sign-in instruction and no in-app login form (screenshot).

### Files Likely Affected

`desktop/src-tauri/src/claude.rs`, `desktop/src-tauri/src/acp/events.rs`, `desktop/src-tauri/src/agents.rs`, `desktop/src-tauri/src/lib.rs`, `desktop/src/Chat.tsx`, `desktop/src/Markdown.tsx`, `desktop/src/chatColumns.ts`, `desktop/tests/`, `desktop/src-tauri/tests/fixtures/`.

---

## Phase 13: MCP into ACP sessions

### Objective

Codex and Gemini sessions receive the nurb MCP server in `session/new`; the app verifies the tools reached the model; adapters that cannot take a server get a materialized working folder captured back as revisions. (Built and verified 2026-09-15 as written; the fallback is the app's own mechanism for an agent without MCP and is not user-facing folder mode, so it survives the same day's folder-mode cut.)

### Rationale

Codex and Gemini honor `mcpServers` today; the Claude adapter does not, and the Cursor adapter once silently ignored it. Gating on advertised capability and verifying after the fact is the only safe way to ship.

### Tasks

- [x] Bump `@agentclientprotocol/codex-acp` from 1.10.0 to the current release in `desktop/adapter-runtime` (check npm; 1.11.0 at planning time).
- [x] `acp.rs`: read `agentCapabilities.mcpCapabilities` from `initialize`; pass an HTTP entry (`type: "http"`, serve URL, token header) when `http` is true, else an untagged stdio entry with an absolute path to `nurb mcp` (never `type: "stdio"` while adapters speak v1). Handle the v2 shape (`agentCapabilities.session.mcp`) behind the same function.
- [x] Verification: one probe session per adapter version (ACP cannot list tools), cached in `mcp-tools.json`; a false verdict picks the folder fallback before `session/new`.
- [x] Folder fallback: `nurb checkout` the project into `<project dir>/checkout`, point the ACP session's `cwd` there, and capture each part file the agent writes back as a revision through `POST /api/projects/{id}/parts/{name}/source`. Used only when tools are unavailable.
- [x] Spike, timeboxed to one hour: the current `claude-agent-acp` (0.74.0 pinned; check for newer) with an HTTP entry. Record in PROGRESS.md whether `mcp__nurb__*` reached the model. Either way the Claude default stays the Phase 12 driver; the adapter remains selectable.
- [x] Chat column renders ACP `tool_call` events with the same `ToolStepCard` as the driver.

### Success Criteria

- A Codex session in the app lists `mcp__nurb__write_part_source` among its tools (adapter log or first-turn verification recorded in PROGRESS.md).
- A Gemini session builds a part through `run_build` with the tool step visible in the chat column (screenshot).
- Forcing capability detection to report no MCP support makes the session use the folder fallback, and a part file the agent writes becomes a new `part_revisions` row with `parent_id` set.
- `desktop/adapter-runtime/package.json` pins codex-acp at the version recorded in PROGRESS.md.
- The Claude adapter spike's outcome is recorded in PROGRESS.md with the adapter version and the exact `mcpServers` entry used.

### Files Likely Affected

`desktop/src-tauri/src/acp.rs`, `desktop/src-tauri/src/acp/mcp.rs`, `desktop/src-tauri/src/acp/events.rs`, `desktop/src-tauri/src/sessions.rs`, `desktop/adapter-runtime/package.json`, `desktop/src/Chat.tsx`, `src/nurb/serve.py`.

---

## Phase 14: App-only: delete the CLI, the Connect panel, and the 1.0.0a1 release

### Objective

The desktop app is the only install and the server it runs is the only MCP server; the `nurb` command line, the PyPI publish and the skill file are deleted; the MCP server's `instructions` carry the "call `read_guide` first" rule; Settings gains a Connect panel that hands Claude Code, the Codex CLI and Cursor the one-line command for the app's local endpoint; the app ships as a GitHub release with the updater.

### Rationale

Decided 2026-09-16: focus is the desktop app, MCP into it, and nurb.app for sharing. A CLI is a second product with its own install, update, docs and support and a worse experience than the app by construction; the engine stays a library so an entrypoint can come back in a day if a real headless audience appears. Non-Mac users get app builds later, not a CLI. The desktop half of ladder 5 lands on main here; its bridge half waits for Phase 15.

### Tasks

- [ ] Delete `src/nurb/cli.py`, `src/nurb_entrypoint/`, the `[project.scripts]` entry, `src/nurb/skill.md`, `src/nurb/agents.md`, `skills/nurb/` and `tests/test_cli.py`; keep `folder.py` (`import_folder` behind `POST /api/import`, `checkout` behind a new `POST /api/projects/{id}/checkout` for the Phase 13 fallback) and the engine modules the serve calls. The supervisor spawns `python -m nurb.serve --port N` (a `__main__` in `serve.py`); the fallback in `acp.rs` calls the route instead of a subprocess; the version agreement test drops the console script.
- [ ] `mcp_server.py`: `instructions` on `initialize` (read the guide first, one paragraph on the workbench URL and the picture in every build result), asserted by the contract test in `tests/test_tools.py`.
- [ ] Connect panel in `desktop/src/Settings.tsx`: the local endpoint (`http://127.0.0.1:<port>/mcp`) and token from `serve.json`, one copyable command each for Claude Code (`claude mcp add --transport http nurb <url> --header "Authorization: Bearer <token>"`), the Codex CLI and Cursor, a "Copied" state, and a one-line note that the app has to be open. Copy the nurb.app Connect page's layout (its `pages/Connect.tsx`); tokens and `Icon` from `@nurb/ui`.
- [ ] `.github/workflows/publish.yml`: build the workbench before the wheel that the app bundles; delete the PyPI job, the `npm` job and both header comments; keep the tag and the GitHub release with the desktop build. `desktop/scripts/release.sh` unchanged except the version mapping.
- [ ] README, `site/`, CLAUDE.md's layout table, and the changelog entry via the `changelog` skill: v2 described as what it is (download the app, talk to it, connect your agent, share on nurb.app), one line that Import brings a v1 folder in, the offline note. No install command, no migration guide.
- [ ] Close the open v1 PRs (#170, #237, #246, #264) with a note that v2 replaced the code they touch and that Windows and Linux builds come as app builds after 1.0.
- [ ] CONTRACT §5 status: ladder 3 shipped with the commit nurb-app pinned; ladder 5's desktop half noted as landed on main.
- [ ] Run the `/release` skill for `1.0.0a1`.

### Success Criteria

- `grep -rn "nurb_entrypoint\|project.scripts\|cli.py" pyproject.toml src tests` returns nothing, and `uv run python -m nurb.serve --help` prints usage.
- A fresh `claude mcp add --transport http nurb <url> --header ...` copied from the Connect panel results in Claude Code listing the server as connected and its `initialize` result carrying the `instructions` text (recorded in PROGRESS.md).
- The Connect panel is captured in `docs/v2/screenshots/phase-14-connect.png` with a real port and a redacted token.
- Forcing the Phase 13 verdict to false still writes `<project>/checkout/parts` and captures an edit as a revision, now through the route (the Phase 13 fallback test re-run).
- `uv run pytest` passes with no test that imports `nurb.cli`.
- `.github/workflows/publish.yml` contains neither `pypi` nor `npm publish`.
- CONTRACT §5 shows ladder 3 as shipped with the commit nurb-app pinned.
- The GitHub release for `1.0.0a1` carries the desktop app build and the updater manifest.

### Files Likely Affected

`src/nurb/cli.py` (deleted), `src/nurb_entrypoint/` (deleted), `skills/` (deleted), `src/nurb/skill.md` and `agents.md` (deleted), `src/nurb/serve.py`, `src/nurb/mcp_server.py`, `pyproject.toml`, `tests/test_cli.py` (deleted), `tests/test_serve.py`, `tests/test_tools.py`, `desktop/src-tauri/src/supervisor.rs`, `desktop/src-tauri/src/acp.rs`, `desktop/src/Settings.tsx`, `.github/workflows/publish.yml`, `README.md`, `CLAUDE.md`, `site/**`, `docs/v2/CONTRACT.md`.

---

## Phase 15: The nurb.app bridge

**Awaits ladders 1 and 2** (nurb-app's OAuth server with the `nurb-desktop` client, and the sync API). Check `https://nurb.app/.well-known/oauth-authorization-server` and the sync endpoints before starting and stop with "blocked on ladder 1" or "blocked on ladder 2" if either is missing; no stubs.

### Objective

Settings gains a nurb.app section with browser sign-in; Publish per part; Back up per project with one-way push, presigned uploads for GLBs and thumbnails, and explicit Pull. Local is the truth and a parent mismatch surfaces as a conflict. Signed out means zero requests.

### Rationale

The only optional network feature besides `nurb://open`. It comes after the release because it depends on another repo, and because everything before it must work with no account.

### Tasks

- [ ] `src/nurb/cloud.py`: OAuth 2.1 PKCE against `https://nurb.app/.well-known/oauth-authorization-server`, loopback redirect on a free port, public client `nurb-desktop`, scopes `sync` and `mcp`, rotating refresh tokens. Token storage through the macOS `security` CLI, a 0600 file elsewhere; no new dependency.
- [ ] Serve endpoints the app calls for sign-in and sign-out (`/api/account`, `POST /api/account/login` opening the browser flow, `DELETE /api/account`); no command line.
- [ ] Push: `PUT /sync/projects/:local_id` with parts (source, card, `parent_revision_id`, `note`), measurements (value, `how`, `provisional`) and printer profile; for each entry in the response's `needs_upload`, `POST /sync/uploads` for presigned R2 URLs by content hash, upload the GLB and thumbnail, then `POST /sync/builds` with hash, stats and findings. A 409 carries the hosted head and shows as a conflict on the project row with the choice to keep local or pull. `GET /sync/projects/:id/changes?since=` for Pull.
- [ ] Publish: a visibility picker plus copy link on the part; `publish_part` tool returns the public URL. The local tool returns a clear `isError` result when signed out.
- [ ] Settings copy: signed-out "Sign in to publish parts and back up projects"; signed-in "Signed in as @handle · Disconnect". Back up is a toggle in the project row menu.
- [ ] Network test: a signed-out serve and app make zero requests to `nurb.app` across a full session (assert with a recording HTTP transport).

### Success Criteria

- With no token stored, a full app session (launch, import, build, export) records zero requests to any `nurb.app` host.
- Sign in from Settings completes in a browser and the serve's `/api/account` returns the handle.
- Publishing a part returns a URL under `https://nurb.app/p/` that renders the part with sliders.
- Turning on Back up pushes the project and the row shows parity; editing a part locally and pushing again shows the new revision on nurb.app.
- Pushing a project whose parent revision no longer matches the hosted head shows a conflict on the project row and writes nothing to nurb.app.
- Turning on Back up for a project with two built parts results in two GLB uploads to presigned URLs followed by two `POST /sync/builds` calls (recorded by the test transport).

### Files Likely Affected

`src/nurb/cloud.py`, `src/nurb/serve.py`, `src/nurb/mcp_server.py`, `desktop/src/Settings.tsx`, `desktop/src/App.tsx`, `desktop/src-tauri/src/lib.rs`, `tests/test_cloud.py`.

---

## Phase 16: The relay client

**Awaits ladder 6** (nurb-app's relay door at `/mcp`, connector OAuth, and the `DesktopChannel` envelope in nurb-app `docs/ops/relay.md`, which does not exist as of 2026-09-13). Check that document and the endpoint before starting and stop with "blocked on ladder 6" if either is missing; no stubs.

### Objective

While the app runs and the user is signed in, it holds one authenticated WebSocket to nurb.app and answers MCP JSON-RPC requests forwarded from claude.ai or ChatGPT by handing them to the local serve's `/mcp` endpoint. nurb.app stores nothing; the user's phone talks to their own nurb instance.

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
- [ ] Retire v1 for real: close v1 issues that no longer apply, release note that Import brings a v1 folder in.

## Notes

- **One port, one framework.** Starlette and uvicorn own the workbench HTTP, the websocket and the MCP endpoint. `http.server` and `watchdog` are gone by Phase 10; `websockets` stays because uvicorn uses it for the websocket route. The Python MCP SDK requires the ASGI stack anyway, so there is no cheaper shape.
- **Nothing but the serve opens the database.** `nurb mcp` was the stdio proxy that kept one writer; it went with the CLI on 2026-09-16 and every client now speaks HTTP to the serve directly.
- **Database location** follows the existing `config.toml` convention (`checks.global_file()`, honors `XDG_CONFIG_HOME`), overridable with `NURB_HOME`. One convention, no platform-dirs dependency.
- **Composite size is a measured gate, not a guess.** Claude Code counts image bytes against its 25,000-token MCP output cap, and the `anthropic/maxResultSizeChars` annotation covers only text. If the 2x2 cannot stay legible under 80,000 base64 characters, build results carry the resource link only and `look` carries the image; that is a CONTRACT bump.
- **`nurb render` drops the browser.** The rasterizer ported from nurb-app renders every view offline, so the playwright extra goes away in Phase 3.
- **v1 stays runnable until Phase 10.** `nurb dev` and `viewer.html` are deleted only once the workbench can do what they did and the bench gate has passed. The desktop app is broken between Phase 10 and Phase 11 by design; both land before any release.
- **No command line** (2026-09-16). The `nurb` console script, the skill and the PyPI publish are deleted in Phase 14. The app spawns `python -m nurb.serve`; Import, Sign in and the fallback's checkout are serve routes. The engine stays a library so an entrypoint can return if a headless audience appears.
- **Never `--hide-claude-auth`, never broker login, never modify the binary.** Those three keep the Claude driver inside Anthropic's carve-out.
- **`tools.json` is this repo's file and the only implementation is the local server.** nurb.app relays to it and never serves tools. A change to a tool name or schema is a CONTRACT §2 bump first.
- **No `check_messages`.** Removed from the contract on 2026-09-13. The workbench transcript is read-only; conversation happens in the app's chat column or the connector's own chat.
- **The Claude adapter is not dead.** It stays selectable and Phase 13 records whether HTTP `mcpServers` reaches the model on the current adapter. When claude-agent-acp #883 closes, the adapter becomes an option again without code churn.
- **Ask before the bench trials** (Phase 5). They spend the subscription.
- **PyPI is not a handoff, and from 2026-09-16 not a channel** (2026-09-15/16). nurb.app pins a commit sha of this public repo for its Modal image (ladder 3 is "the v2 engine is pushed"); the app bundles its own wheel. Nothing installs from PyPI, so Phase 14 deletes the job.
- **Folder mode is not a user path** (2026-09-15). v1's folder engine CLI was migration weight; Josh cut it and Phase 14 deletes it with the rest of the CLI. `import_folder` stays behind the app's Import button so a v1 project comes in once; `checkout` stays behind a serve route for the Phase 13 fallback and the bench harness.
- **`@nurb/ui` is never published** (2026-09-15). It is an npm workspace package consumed by `packages/workbench` and `desktop/`; nurb.app keeps its own frontend, so ladder 4 is gone and the only cross-repo artifact is the wheel (ladder 3, Phase 14). The publish workflow's PyPI job is gated on the workbench bundle until then; Phase 14 deletes the `npm` job.
