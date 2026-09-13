# nurb v2 Research

Decision record from the 2026-09-13 session (research ran in the nurb-app repo; its addendum is at `nurb-app/docs/core/RESEARCH.md` → "Addendum 2026-09-13"). This file is the seed for the v2 `/build` pipeline in this repo. The contract with nurb.app is `docs/v2/CONTRACT.md`.

## Overview

v2 resets the product layer of this repo around a database and a tool contract, keeps the engine and the Tauri core, and rebuilds the desktop app on the design system that currently lives in the hosted app. It stays what v1 promised: free, offline, no account, driven by the agent the user already pays for. It gains one optional bridge: sign in to nurb.app to publish parts and back up projects.

## Problem statement

v1 was the shape being found. A project is any directory with `parts/`; `measured()` resolves by walking up from the caller's `__file__` to `measurements.toml`; `edit.py` rewrites ASTs on disk behind a `_*.tmp` namespace; a leading underscore hides a part; cards are `.md` sidecars; the agent's file tools and the app write the same files; there is no revision history, no build history, no transcript tied to a part. Each of those is a stale-state bug waiting to happen. The hosted app avoided all of them by making rows the truth and files a materialization, and it is the better model.

The second problem is drift. The hosted app forked the engine at v0.24.0 and already differs in `builder.py` and `doctrine.md`; it also has a newer viewer, params panel and design system in React that this repo does not. Two engines and two viewers diverge for as long as both exist.

The third is policy. Anthropic permits the user to sign into the unmodified Claude Code binary on their own machine, and nothing else. The desktop app's Claude path today runs Zed's ACP adapter on the Agent SDK, which is the path Anthropic's paused subscription meter targets. v2 must be able to drive the interactive `claude` binary in a PTY as the fallback.

## User stories

- Install the app, sign into nothing, describe a bracket to Claude Code inside the app, drag sliders, print. No network calls to nurb.app.
- Same person, Claude Code in a terminal without the desktop app: `pip install nurb`, `claude mcp add nurb -- nurb mcp`, the viewer opens from `nurb serve`.
- Click Publish on a part; it appears at nurb.app/p/<slug> with live sliders. Turn on Back up for a project; its revisions survive a new laptop.
- Open a public part from the web with "Open in nurb"; it lands as a new local project with its measurements.
- A v1 user runs `nurb import ./my-project` and their folder becomes rows.

## Technical research

### Approach options

| | Truth | Agent edits via | Verdict |
|---|---|---|---|
| A. Keep files (v1) | disk | file tools | Rejected: stale state, no history, two writers |
| B. Files + watcher capture | disk, mirrored to rows | file tools | Rejected: the same race with extra machinery |
| C. SQLite + tools | rows | MCP tools served by `nurb serve` | **Chosen.** Same model as nurb.app; sync is rows in, rows out |
| D. Per-project `.nurb/db` | rows per folder | tools | Rejected: the library page needs one database; folders return as import/export |

### Recommended approach

**Keep** the engine (`registry, builder, checks, holes, polish, orient, probe, crown, stress, mesh, slicing, assembly, card, compare, extract, scan`, doctrine, tests) and the Tauri core (`provision.rs, acp.rs, supervisor.rs, sessions.rs`, updater, signing, release script). **Rebuild** `server.py`, `cli.py`, `viewer.html`, `edit.py`, the `measurements.py` resolution walk, `skill.md`, and the desktop UI. Same repo, `v0.26.0` tagged as the last v1, v2 on `main` shipping as 1.0.0, no `legacy/` folder (git history is the reference).

- **`nurb.server`**: one SQLite database per machine in app data, WAL, owned by one process. Tables mirror the hosted schema: projects, parts, part_revisions, build_runs, measurements, messages, pinned_specs. Serves the viewer over localhost and the MCP tools over stdio (`nurb mcp`) and localhost. Builds materialize a scratch directory exactly as the hosted `Engine::Materializer` does, so the engine and `measured()` are untouched.
- **`nurb/tools.json`**: the tool contract (CONTRACT.md §2). The Python server implements it against SQLite; nurb.app implements it against Rails. A contract test diffs `tools/list` against the file.
- **`packages/ui` → `@nurb/ui`**: extracted once from nurb-app's `web/app/frontend` (tokens, Icon, ViewerIsland, ParamsPanel, ExportMenu, chat cards, markdown policy). Transport-agnostic. Published to npm in the same release as the wheel. After the extraction, design work happens here and nurb.app consumes it.
- **Desktop**: Rust core kept; UI rebuilt on `@nurb/ui` (project rail, chat column, viewer); spawns `nurb serve`; passes the local MCP server to each ACP session so agents use tools, never files; Claude path can fall back to the interactive `claude` binary in a PTY. One viewer for `nurb serve` and the desktop app.
- **Bridge to nurb.app** (optional): Settings → nurb.app, browser OAuth with loopback (`nurb-desktop` public client, PKCE), token in Keychain; Publish per part, Back up per project (one-way push, explicit Pull), `nurb://open` deep link. Signed out means zero requests, tested.
- **Relay client** (optional, after sign-in): while the app runs it holds one WebSocket to nurb.app and answers MCP requests forwarded from claude.ai or ChatGPT by handing them to the local `nurb mcp` server. This is how a phone talks to "your nurb instance"; nurb.app runs no tools of its own. Decided 2026-09-13; see CONTRACT.md §4 and ladder step 7.
- **Skill**: shrinks to "add the nurb MCP server, call `read_guide` first". The benchmark harness (nurb-benchmarks) drives the tool path.

### Required technologies

Python 3.13, `sqlite3` stdlib (no new dependency), the official Python MCP SDK for `nurb mcp` (stdio + Streamable HTTP), build123d 0.11.1 / OCP unchanged, Tauri 2 + existing plugins, React 19, three 0.185, Vite, an npm workspace (`desktop/`, `packages/ui`). ACP adapters as today; `agent-client-protocol` session config carries the MCP server.

### Data requirements

Local schema = subset of nurb.app's, with stable ids (UUIDs) so sync maps rows by id; `part_revisions` carry `parent_id` so a conflict is a parent mismatch. Import from a v1 folder creates a project, parts (one revision each), and measurements with `how` from the TOML. Export writes the same folder shape back for git users.

## UI/UX considerations

The design system is decided (nurb-app `docs/core/DESIGN.md`: white chassis, mono-forward, vermilion object, Satoshi 700 headlines, Nucleo 12px icons). The desktop app adopts it wholesale through `@nurb/ui`. The chat column renders one collapsed line per tool step (verb, object, duration), build cards and renders inline, no separate activity rail (Claude Code's web session view is the reference). Settings gets an agents section (as today) and a nurb.app section: signed-out copy "Sign in to publish parts and back up projects", signed-in "Signed in as @handle · Disconnect". Publish is a visibility picker plus copy link on the part; Back up is a toggle in the project row menu. No pulsing indicators; elapsed counters in tabular mono carry liveness.

## Integration points

- nurb.app consumes `nurb` (engine + `tools.json` in its Modal image) and `@nurb/ui` (Inertia pages, MCP App bundle). Its `engine/` becomes an overlay (`hosted.py`, `thumbnail.py`, `modal_app.py`).
- nurb-benchmarks drives `nurb mcp` instead of the file skill; the six graded jobs are v2's regression gate.
- The ACP adapters (`@agentclientprotocol/claude-agent-acp`, `codex-acp`, Gemini CLI) receive the MCP server in `session/new`.

## Risks and challenges

- **Second-system effect.** Guard: bench jobs pass on v2 through the tool path before v1 is retired; engine tests never go red; foundation timeboxed before any feature.
- **Tool layer in two languages.** Guard: `tools.json` is the only source of names, descriptions, schemas; contract tests both sides.
- **Anthropic's meter returns.** Guard: PTY fallback for the interactive binary; nothing in the app depends on the Agent SDK path.
- **Agents that cannot take an MCP server over ACP** (check each adapter). Fallback: the agent gets a materialized working folder for that session and the server captures edits back as revisions, the hosted materializer pattern, used only where tools are unavailable.
- **Migration of v1 users.** Small population (533 stars); `nurb import` plus a release note.
- **One process owns the database.** `nurb serve` must be the only writer; the desktop app and `nurb mcp` connect to it rather than opening the file.

## Decisions made

- Reset the product layer, keep the engine and the Tauri core (Josh, 2026-09-13).
- SQLite is the truth; agents use tools; files are import and export (Josh, 2026-09-13).
- Same repo; `v0.26.0` is the last v1; v2 ships as 1.0.0 (Josh, 2026-09-13).
- `@nurb/ui` lives here, extracted once from nurb-app, consumed by nurb.app forever after (Josh, 2026-09-13).
- Two `/build` pipelines coordinated by `docs/v2/CONTRACT.md` and a handoff ladder of published versions (Josh, 2026-09-13).

## Open questions

- Which ACP adapters accept an MCP server in `session/new` today, and whether the Claude adapter can be swapped for a PTY-driven `claude` without losing the structured transcript.
- Whether the thumbnail renderer (`hosted.py`/`thumbnail.py`) moves into the wheel for local library thumbnails.
- Packaging of the Python MCP SDK inside the Tauri-provisioned venv (size, startup time).
- `@nurb/ui` build target for the MCP App (single self-contained HTML) and whether it lives here or in nurb-app.
- Exact `/sync` shape (CONTRACT.md §4 is a draft).

## References

- nurb-app `docs/core/RESEARCH.md` addendum 2026-09-13 (policy, protocol, market evidence, pricing) and `docs/core/DESIGN.md`.
- Anthropic legal page: code.claude.com/docs/en/legal-and-compliance. MCP 2026-07-28 spec. ACP (agentclientprotocol.com). Python MCP SDK.
- nurb-benchmarks: github.com/Shpigford/nurb-benchmarks.
