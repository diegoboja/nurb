"""Run a nurb benchmark task through the v2 MCP tool path instead of the file path.

Each trial materializes the task's project, imports it into an isolated NURB_HOME,
and points claude at `nurb mcp` as its only route to the part. --dry-run skips claude
and drives the same stdio proxy itself with the reference solution, to prove the rig.
"""

import argparse
import asyncio
import json
import os
import pathlib
import signal
import subprocess
import sys
import time

# This repo's checkout (the script lives at docs/v2/bench/), and the benchmarks repo,
# which NURB_BENCHMARKS points at when it is not a sibling of this checkout.
WORKSPACE = pathlib.Path(__file__).resolve().parents[3]
NURB = WORKSPACE / ".venv/bin/nurb"
BENCH = pathlib.Path(os.environ.get("NURB_BENCHMARKS", WORKSPACE.parent / "nurb-benchmarks"))
SEED = 13
TASKS = ["cable_clip", "bit_block", "bundle_holder", "pole_rest", "valve_knob", "leg_cup"]

TOOL_PREAMBLE = """\
You are being benchmarked, non-interactively. There is no human to ask and no browser to look at: never wait for input and never ask questions. nurb is attached as an MCP server; its tools are your only way to read, write and build parts, and their results are your only feedback. Call read_guide once before writing any source. The project "{name}" (id {project_id}) already exists and holds the measurements: work in it, and do not create another. Where the task says to save a file as parts/<name>.py, that means write_part_source with part_name "{name}" in that project; there is no file system to write to. When you are done, that part must build with zero findings.

"""

sys.path.insert(0, str(BENCH / "src"))


def scrubbed_env(cwd):
    env = dict(os.environ)
    for name in tuple(env):
        if name.startswith("CONDUCTOR_") or name in {
            "OLDPWD", "PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV",
        }:
            env.pop(name)
    env["PWD"] = str(cwd)
    return env


def nurb(args, home, cwd=None):
    env = dict(os.environ, NURB_HOME=str(home))
    done = subprocess.run(
        [str(NURB), *args], cwd=cwd, env=env, capture_output=True, text=True
    )
    if done.returncode != 0:
        raise RuntimeError(f"nurb {' '.join(args)} failed: {done.stderr.strip()[-400:]}")
    return done.stdout


def stop_serve(home):
    state = home / "serve.json"
    if not state.is_file():
        return
    pid = json.loads(state.read_text()).get("pid")
    if not pid:
        return
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    for _ in range(100):
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return
        time.sleep(0.1)


def run_claude(cmd, cwd, timeout):
    process = subprocess.Popen(
        cmd, cwd=cwd, env=scrubbed_env(cwd), stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, start_new_session=True,
    )
    try:
        stdout, stderr = process.communicate(timeout=timeout)
        return process.returncode, stdout, stderr, False
    except subprocess.TimeoutExpired:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        stdout, stderr = process.communicate()
        return process.returncode, stdout, stderr, True


async def drive_tools(home, project_id, task_name, source, lift=None):
    """The dry run: the reference solution written through the real stdio proxy."""
    from mcp import Client, StdioServerParameters

    params = StdioServerParameters(
        command=str(NURB), args=["mcp"], env={**os.environ, "NURB_HOME": str(home)}
    )
    log = []
    async with Client(params) as client:
        listed = await client.call_tool("list_projects", {})
        log.append(("list_projects", listed.content[0].text))
        if lift is not None:
            recorded = await client.call_tool("record_measurement", {
                "project_id": project_id, "name": "lift", "value_mm": lift,
                "how": "guess from the shim that fell out, 2.0-5.0 band",
                "provisional": True,
            })
            log.append(("record_measurement", recorded.content[0].text))
        built = await client.call_tool("write_part_source", {
            "project_id": project_id, "part_name": task_name, "source": source,
        })
        text = next((c.text for c in built.content if getattr(c, "text", None)), "")
        log.append(("write_part_source", text))
    return log


MATERIALIZE = """\
import json, pathlib, sys
from nurb_evals import scoring
task = scoring.load_task(sys.argv[1])
task.materialize(int(sys.argv[3]), sys.argv[2])
print(json.dumps({"instruction": task.instance(int(sys.argv[3])).instruction}))
"""


def materialize(task_name, project):
    """In the benchmarks venv: a task module can import deps the workspace lacks."""
    done = subprocess.run(
        ["uv", "run", "python", "-c", MATERIALIZE,
         str(BENCH / "tasks" / task_name), str(project), str(SEED)],
        cwd=BENCH, capture_output=True, text=True, env=scrubbed_env(BENCH),
    )
    if done.returncode != 0:
        raise RuntimeError(f"materialize {task_name} failed: {done.stderr[-500:]}")
    return json.loads(done.stdout.strip().splitlines()[-1])["instruction"]


def grade(part, task_name):
    done = subprocess.run(
        ["uv", "run", "python", "-m", "nurb_evals.grade", str(part),
         f"tasks/{task_name}", str(SEED)],
        cwd=BENCH, capture_output=True, text=True, env=scrubbed_env(BENCH),
    )
    for line in done.stdout.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict):
            return value
    raise RuntimeError(f"grade printed no JSON: {done.stdout[-300:]} {done.stderr[-500:]}")


def trial(task_name, out, model, effort, timeout, dry_run):
    from nurb_evals import harness

    slot = out / task_name / "trial_1"
    if slot.exists():
        raise RuntimeError(f"{slot} already exists; every trial gets a fresh directory")
    slot.mkdir(parents=True)
    home, project, cwd, checkout = (slot / n for n in ("home", "project", "cwd", "checkout"))
    home.mkdir()
    cwd.mkdir()

    instruction = materialize(task_name, project)
    (project / "AGENTS.md").unlink(missing_ok=True)

    project_id = nurb(["import", str(project)], home).splitlines()[0].strip()
    mcp_json = slot / "mcp.json"
    mcp_json.write_text(json.dumps({"mcpServers": {"nurb": {
        "command": str(NURB), "args": ["mcp"], "env": {"NURB_HOME": str(home)},
    }}}, indent=2))

    prompt = TOOL_PREAMBLE.format(name=task_name, project_id=project_id)
    prompt += instruction

    cmd = harness.ClaudeCode().command(prompt, model=model, effort=effort, instructions=None)
    cmd.insert(cmd.index("--strict-mcp-config") + 1, "--mcp-config")
    cmd.insert(cmd.index("--mcp-config") + 1, str(mcp_json))
    # --safe-mode drops every MCP server on claude 2.1.270 (measured: the init event
    # reports mcp_servers: [] with it and the connected server without it).
    cmd.remove("--safe-mode")
    # The tools are the only route to the part, as the desktop driver will run it.
    cmd += ["--disallowedTools", "Bash,Edit,Write,MultiEdit,NotebookEdit,Task,Agent"]

    usage, returncode, error, stdout = {}, 0, None, ""
    started = time.monotonic()
    if dry_run:
        if task_name == "cable_clip":
            print("claude argv for cable_clip:\n" + json.dumps(cmd, indent=2))
        source = (BENCH / "tests/solutions" / task_name / "good.py").read_text()
        lift = 3.0 if task_name == "leg_cup" else None
        log = asyncio.run(drive_tools(home, project_id, task_name, source, lift=lift))
        stdout = "\n\n".join(f"== {name} ==\n{text}" for name, text in log)
        print(f"  {task_name} write_part_source: {log[-1][1][:300]}")
    else:
        returncode, stdout, stderr, timed_out = run_claude(cmd, cwd, timeout)
        if timed_out:
            error = f"claude hit the {timeout:.0f}s wall-clock cap"
        elif returncode != 0:
            error = f"claude exited {returncode}: {stderr.strip().splitlines()[-2:]}"
        usage = harness.ClaudeCode().usage(stdout)
    harness_s = round(time.monotonic() - started, 1)
    (slot / "transcript.txt").write_text(stdout, encoding="utf-8")

    stop_serve(home)
    nurb(["checkout", project_id, str(checkout)], home)

    part = checkout / "parts" / f"{task_name}.py"
    verdict = grade(part, task_name) if part.is_file() else {
        "built": False, "score": 0.0, "stages": {}, "error": error or "no part in checkout",
    }
    (slot / "grade.json").write_text(json.dumps(verdict, indent=2))

    import nurb as nurb_pkg
    row = {
        "task": task_name, "seed": SEED, "trial": 1, "harness": "claude",
        "harness_version": subprocess.run(
            ["claude", "--version"], capture_output=True, text=True
        ).stdout.strip(),
        "model": model, "effort": effort, "nurb_version": nurb_pkg.__version__,
        "path": "tools", "built": verdict["built"], "score": verdict["score"],
        "stages": verdict.get("stages"), "error": verdict.get("error") or error,
        "harness_s": harness_s, "timeout_s": timeout, "usage": usage,
        "transcript": str(slot / "transcript.txt"),
    }
    with (out / "results.jsonl").open("a") as handle:
        handle.write(json.dumps(row) + "\n")
    return row


def main():
    ap = argparse.ArgumentParser(description="run a benchmark task through the v2 tools")
    ap.add_argument("--task", action="append", default=None)
    ap.add_argument("--model", default="claude-opus-5")
    ap.add_argument("--effort", default="high")
    ap.add_argument("--out", required=True)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--timeout", type=float, default=1800.0)
    args = ap.parse_args()

    names = args.task or ["cable_clip"]
    if "all" in names:
        names = TASKS
    out = pathlib.Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for name in names:
        row = trial(name, out, args.model, args.effort, args.timeout, args.dry_run)
        rows.append(row)
        print(f"{row['task']} {row['score']:.3f} built={row['built']} {row['error'] or ''}")
    return 0 if all(r["score"] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main())
