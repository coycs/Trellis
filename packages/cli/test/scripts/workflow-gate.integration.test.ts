import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPTS = path.resolve(__dirname, "../../src/templates/trellis/scripts");
const PYTHON = ["python3", "python"].find((name) => {
  try {
    execFileSync(name, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

function python() {
  if (!PYTHON) throw new Error("Python is required");
  return PYTHON;
}

function git(root: string, ...args: string[]) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function setup(root: string) {
  const trellis = path.join(root, ".trellis");
  fs.mkdirSync(trellis, { recursive: true });
  fs.cpSync(SCRIPTS, path.join(trellis, "scripts"), { recursive: true });
  const task = path.join(trellis, "tasks", "task");
  fs.mkdirSync(task, { recursive: true });
  fs.writeFileSync(path.join(task, "task.json"), JSON.stringify({ status: "planning", meta: {} }));
  fs.writeFileSync(path.join(task, "prd.md"), "# Requirement\n");
  fs.writeFileSync(path.join(root, "source.txt"), "v1\n");
  git(root, "init"); git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test"); git(root, "add", ".");
  git(root, "commit", "-m", "initial");
  return task;
}

function run(root: string, ...args: string[]) {
  return spawnSync(python(), [".trellis/scripts/task.py", ...args], {
    cwd: root, encoding: "utf8",
    env: { ...process.env, TRELLIS_CONTEXT_ID: "test" },
  });
}

function data(task: string) {
  return JSON.parse(fs.readFileSync(path.join(task, "task.json"), "utf8"));
}

describe.skipIf(!PYTHON)("strict task lifecycle", () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-lifecycle-")); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it("blocks start without approval", () => {
    const task = setup(root);
    expect(run(root, "start", "task").status).toBe(1);
    expect(data(task).status).toBe("planning");
  });

  it("binds approval to artifacts and starts exactly once", () => {
    const task = setup(root);
    expect(run(root, "approve", "task").status).toBe(0);
    expect(run(root, "start", "task").status).toBe(0);
    const workflow = data(task).meta.workflow;
    expect(workflow.schemaVersion).toBe(2);
    expect(workflow.revision).toBe(2);
    expect(workflow.approval.artifacts).toEqual(workflow.artifacts);
  });

  it("invalidates changed planning artifacts", () => {
    const task = setup(root);
    expect(run(root, "approve", "task").status).toBe(0);
    fs.appendFileSync(path.join(task, "prd.md"), "changed\n");
    expect(run(root, "start", "task").status).toBe(1);
    expect(data(task).status).toBe("planning");
  });

  it("records evidence only after a real passing command", () => {
    const task = setup(root);
    run(root, "approve", "task"); run(root, "start", "task");
    git(root, "add", "."); git(root, "commit", "-m", "start");
    expect(run(root, "review", "task", "--", python(), "-c", "raise SystemExit(2)").status).toBe(1);
    expect(data(task).status).toBe("in_progress");
    expect(run(root, "review", "task", "--", python(), "-c", "print('ok')").status).toBe(0);
    expect(data(task).status).toBe("review");
    expect(data(task).meta.workflow.evidence[0].commit).toBe(git(root, "rev-parse", "HEAD"));
  });

  it("rejects review on a dirty worktree", () => {
    const task = setup(root);
    run(root, "approve", "task"); run(root, "start", "task");
    fs.writeFileSync(path.join(root, "source.txt"), "dirty\n");
    expect(run(root, "review", "task", "--", python(), "-c", "print('ok')").status).toBe(1);
    expect(data(task).status).toBe("in_progress");
  });

  it("archives only fresh reviewed work", () => {
    setup(root);
    run(root, "approve", "task"); run(root, "start", "task");
    git(root, "add", "."); git(root, "commit", "-m", "start");
    expect(run(root, "review", "task", "--", python(), "-c", "print('ok')").status).toBe(0);
    git(root, "add", "."); git(root, "commit", "-m", "review");

    expect(run(root, "archive", "task", "--no-commit").status).toBe(0);
    const archive = path.join(root, ".trellis", "tasks", "archive");
    const archived = fs.readdirSync(archive)
      .map((month) => path.join(archive, month, "task", "task.json"))
      .find(fs.existsSync);
    expect(archived).toBeDefined();
    if (!archived) throw new Error("Archived task is missing");
    expect(JSON.parse(fs.readFileSync(archived, "utf8")).status).toBe("completed");
  });

  it("rejects archive before review and after source changes", () => {
    const task = setup(root);
    expect(run(root, "archive", "task", "--no-commit").status).toBe(1);
    run(root, "approve", "task"); run(root, "start", "task");
    git(root, "add", "."); git(root, "commit", "-m", "start");
    run(root, "review", "task", "--", python(), "-c", "print('ok')");
    git(root, "add", "."); git(root, "commit", "-m", "review");
    fs.writeFileSync(path.join(root, "source.txt"), "v2\n");
    git(root, "add", "."); git(root, "commit", "-m", "source changed");

    const result = run(root, "archive", "task", "--no-commit");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("test evidence is stale");
    expect(data(task).status).toBe("review");
  });
});
