# Contributing to nurb

The [README](README.md) is about using nurb. This file is about hacking on it.

## How it works

### The build loop

`uv run python -m nurb.serve` starts one long-lived process: an SQLite database of projects and parts, the MCP tool surface an agent drives, and an HTTP plus websocket server on one port (7373 by default, or the next free one; `--port` pins it). Builds run in a spawned worker that stays warm, because importing the OCCT kernel costs about 45 seconds cold. After that, rebuilds run 30 to 400ms depending on the part, which matters because an agent iterates in build-check cycles, dozens per part.

A build flows like this:

```
an agent calls run_build
  -> the project is materialized out of the database into a scratch folder
  -> @part functions rebuild with the requested overrides
  -> the B-rep is tessellated (a direct indexed read of OCCT's triangles, ~30ms)
  -> the GLB and the findings land in a build_runs row
  -> the workbench is told over the websocket and swaps the mesh
```

A build error takes the same path: the traceback is trimmed to the user's own part file, the run row says `error`, and the last good geometry stays on screen. A fault that kills the kernel outright is contained too, because the worker is a separate process; the run row says the engine stopped and the next build starts a new worker.

### The workbench

`packages/workbench` is a React page built into `src/nurb/workbench/`: three.js, Z-up, camera persistence across rebuilds, one control per keyword parameter, a section plane, check findings pinned to the faces they fired on, a print time row, a stress button, and export buttons. The desktop app embeds the same page, so a browser tab and the app show the same thing.

### The modules

| Module | What it owns |
|--------|--------------|
| `src/nurb/registry.py` | `@part`, signature introspection: keyword defaults become parameters |
| `src/nurb/builder.py` | load, build, tessellate, GLB |
| `src/nurb/checks.py` | the printability rules, convexity, `Finding`/`Context`, variants |
| `src/nurb/probe.py` | what the inspect tool measures, in the rules' own units |
| `src/nurb/polish.py` | the bisecting polish pass, and chamfer with real errors |
| `src/nurb/crown.py` | `crown()`, a rounded bead on a rim, on request |
| `src/nurb/orient.py` | `stand()`, the diagonal print stance with its bed facet |
| `src/nurb/holes.py` | `counterbore()` and friends |
| `src/nurb/assembly.py` | `assembly`, `use`, `hinge`, `obstacle` |
| `src/nurb/mesh.py` | `import_stl()`, flat-faced meshes that can become a solid |
| `src/nurb/scan.py` | measuring a foreign mesh in mm, a phone scan or a download |
| `src/nurb/compare.py` | deviation from a target mesh, in both directions |
| `src/nurb/measurements.py` | `measured()`, and the refusal to guess |
| `src/nurb/card.py` | the card's AUTO block |
| `src/nurb/edit.py` | the keyword-default rewrite behind Apply |
| `src/nurb/extract.py` | duplication across sibling parts, up to alpha-equivalence |
| `src/nurb/slicing.py` | the handoff to an installed slicer, and the two numbers back |
| `src/nurb/stress.py` | voxel FEA behind the stress tool and the viewer's stress button |
| `src/nurb/render.py` | headless PNG through the numpy rasterizer in `raster.py`, no browser |
| `src/nurb/db.py` | the SQLite schema: projects, parts, revisions, build runs |
| `src/nurb/engine_run.py` | one build, from rows to a `build_runs` row, in a warm worker |
| `src/nurb/materialize.py` | rows written back out as the folder the engine builds |
| `src/nurb/folder.py` | `import_folder` and `checkout`, the doors between a folder and the store |
| `src/nurb/spec.py` | the pinned build spec, and how an amendment merges into it |
| `src/nurb/mcp_server.py` | the agent tool surface, defined by `tools.json` |
| `src/nurb/toolschema.py` | `tools.json` rewritten for the Anthropic Messages API |
| `src/nurb/guide.py` | doctrine, vocabulary and kernel notes as one document for a model |
| `src/nurb/serve.py` | HTTP + websocket + MCP on one port |
| `src/nurb/api.py` | the vocabulary, derived from `__all__` so it cannot drift |
| `src/nurb/doctrine.md` | the design doctrine, shipped in the package, read by agents through the `read_guide` tool |
| `src/nurb/printers.toml` | shipped printer profiles |

The public API is `src/nurb/__init__.py`: everything exported there is a promise, everything else is internal and free to change.

## Setup

Prerequisites:

- [uv](https://docs.astral.sh/uv/). It fetches the right Python (3.13+) on its own.
- For the desktop app only: a Rust toolchain, Node 22+, and Xcode command line tools.

```bash
git clone https://github.com/Shpigford/nurb.git
cd nurb
uv sync --locked --all-extras --dev
```

## Run it against a real project

`examples/notch` and `examples/demo` are real projects. Serve the checkout and bring one in:

```bash
uv run python -m nurb.serve
```

Import `examples/notch` from the app, or from any agent connected to that server, and the parts show up in the workbench.

The workbench URL takes `?part=<name>&variant=<name>` to deep-link the exact configuration you want looked at.

## Dependencies are a cost

Runtime dependencies: build123d, mcp, pillow, trimesh, websockets. Adding another dependency needs a strong, stated reason. Anything new the workbench imports is bundled into `src/nurb/workbench/` by its own build, because the workbench must keep working with no network.

## Testing

```bash
uv run pytest           # the suite
uv run pytest -n auto   # parallel; the suite is CPU-bound OCCT builds and scales almost perfectly
```

The parts in `examples/` are the calibration set, asserted against dimensions from really-printed parts, so a broken example is a red build rather than a stale README. Fit tests use literal numbers, never the part's own constants, because a test that reads the same constant as the code cannot catch that constant being wrong.

The model benchmark (tasks, scorer, and every submitted run) lives in its own repo, [Shpigford/nurb-benchmarks](https://github.com/Shpigford/nurb-benchmarks), with its own suite and CI.

CI (`.github/workflows/test.yml`) runs the pytest suite on every push and PR. It builds every part in `examples/`, which exercises the rules against the real library on a machine they were not calibrated on.

## The desktop app

`desktop/` is a Tauri shell around nurb: project rail, agent chat column, and the live viewer in one window. The app embeds the workbench page, so features about the part itself land in `packages/workbench` and reach both the app and the served page in a browser; React shell work is only for what the shell alone can do.

```bash
npm install
npm run tauri dev --workspace desktop
```

The repo root is an npm workspace holding `desktop/` and `packages/ui` (the React design package), so one `npm install` at the root serves both and the only lockfile is the root one. Debug builds run nurb out of the checkout and need no provisioning. Release builds provision everything on first launch into `~/Library/Application Support/dev.nurb.desktop`: a managed CPython and venv with the bundled nurb wheel, a pinned Node, and the agent ACP adapters. `desktop/README.md` has the full provisioning and signing story.

The page the server shows at `/` is the built output of `packages/workbench`: `npm run build --workspace packages/workbench` writes it into `src/nurb/workbench/`, which is gitignored and carried in the wheel. So `uv build` and the publish workflow both need that build to have run first, and a server with no bundle answers `/` with the npm command to run.

## Debugging the workbench

The URL takes `?part=<name>`, `?view=iso|front|back|left|right|top`, and `?bare`. three.js is bundled into `src/nurb/workbench/` by the workbench build, so the page needs no network.

A geometry trap worth knowing: `BRep_API: command not done` from a chamfer means two chamfered edges have less than `2 * chamfer_size` of face between them. Every edge chamfers fine on its own and only the batch fails, so testing one at a time reports nothing wrong. Bisect the set; `polish()` does this bisection for you.

## Releasing

A release is one version across the engine and the app, and it is triggered by a merge, not a button:

1. Bump the version in three places, and a test enforces they agree: `uv version X.Y.Z` (pyproject), `version` in `desktop/src-tauri/tauri.conf.json` as semver, and `version` in `packages/ui/package.json`.
2. Merge to main. `.github/workflows/publish.yml` sees the untagged version, builds the workbench and the wheel, then creates the `vX.Y.Z` tag and the GitHub release with generated notes and the wheel attached. The job is idempotent: an already-tagged version is skipped.
3. Run `desktop/scripts/release.sh` from a Mac with the Developer ID certificate in the keychain. It builds, signs, and notarizes the app for Apple silicon and Intel, bundles that wheel into it, uploads `nurb.dmg` and `nurb-intel.dmg` plus updater archives into that same GitHub release, and refreshes `latest.json` on the rolling `desktop-latest` prerelease that installed apps poll for self-updates. It refuses to upload twice for one version.

The release date matters beyond shipping: FSL-1.1-MIT converts each version to MIT two years after its release, and the GitHub release is that date, published.
