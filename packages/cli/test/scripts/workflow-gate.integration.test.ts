import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPTS = path.resolve(__dirname, "../../src/templates/trellis/scripts");
const PYTHON = ["python3", "python"].find((name) => {
  try { execFileSync(name, ["--version"], { stdio: "ignore" }); return true; }
  catch { return false; }
});

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
  return spawnSync(PYTHON!, [".trellis/scripts/task.py", ...args], {
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
    expect(run(root, "review", "task", "--", PYTHON!, "-c", "raise SystemExit(2)").status).toBe(1);
    expect(data(task).status).toBe("in_progress");
    expect(run(root, "review", "task", "--", PYTHON!, "-c", "print('ok')").status).toBe(0);
    expect(data(task).status).toBe("review");
    expect(data(task).meta.workflow.evidence[0].commit).toBe(git(root, "rev-parse", "HEAD"));
  });

  it("rejects review on a dirty worktree", () => {
    const task = setup(root);
    run(root, "approve", "task"); run(root, "start", "task");
    fs.writeFileSync(path.join(root, "source.txt"), "dirty\n");
    expect(run(root, "review", "task", "--", PYTHON!, "-c", "print('ok')").status).toBe(1);
    expect(data(task).status).toBe("in_progress");
  });
});
