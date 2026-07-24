import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const TEMPLATE_SCRIPTS = path.resolve(
  __dirname,
  "../../src/templates/trellis/scripts",
);

function resolvePython(): string | undefined {
  for (const candidate of ["python3", "python"]) {
    try {
      execFileSync(candidate, ["--version"], { stdio: "ignore" });
      return candidate;
    } catch {
      // Try the next host alias.
    }
  }
  return undefined;
}

const PYTHON = resolvePython();
const PYTHON_COMMAND = PYTHON ?? "python";

interface WorkflowMetadata {
  schemaVersion: number;
  mode: string;
  complexity: string;
  revision: number;
  artifacts: Record<string, string>;
  approvals: { artifacts: Record<string, string> }[];
}

interface TaskData {
  status: string;
  meta: { workflow?: WorkflowMetadata };
}

function setupRepo(root: string, mode: "off" | "warn" | "strict"): string {
  const trellisDir = path.join(root, ".trellis");
  fs.mkdirSync(trellisDir, { recursive: true });
  fs.cpSync(TEMPLATE_SCRIPTS, path.join(trellisDir, "scripts"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(trellisDir, "config.yaml"),
    `workflow_gates:\n  mode: ${mode}\n`,
  );

  const taskDir = path.join(trellisDir, "tasks", "07-24-gated-task");
  fs.mkdirSync(taskDir, { recursive: true });
  fs.writeFileSync(
    path.join(taskDir, "task.json"),
    JSON.stringify({ status: "planning", meta: {} }, null, 2),
  );
  fs.writeFileSync(path.join(taskDir, "prd.md"), "# Requirement\n\nReady.\n");
  return taskDir;
}

function runTask(root: string, ...args: string[]) {
  return spawnSync(PYTHON_COMMAND, [".trellis/scripts/task.py", ...args], {
    cwd: root,
    encoding: "utf-8",
    env: { ...process.env, TRELLIS_CONTEXT_ID: "workflow-gate-test" },
  });
}

function readTask(taskDir: string): TaskData {
  return JSON.parse(
    fs.readFileSync(path.join(taskDir, "task.json"), "utf-8"),
  );
}

describe.skipIf(!PYTHON)("planning → in_progress workflow gate", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-workflow-gate-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("strict mode blocks before status and active-task pointer mutation", () => {
    const taskDir = setupRepo(root, "strict");

    const result = runTask(root, "start", "07-24-gated-task");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("implementation approval is missing");
    expect(readTask(taskDir).status).toBe("planning");
    expect(fs.existsSync(path.join(root, ".trellis", ".runtime"))).toBe(false);
  });

  it("records a hash-bound approval and allows an unchanged lightweight plan", () => {
    const taskDir = setupRepo(root, "strict");

    const approval = runTask(root, "approve", "07-24-gated-task");
    const start = runTask(root, "start", "07-24-gated-task");
    const task = readTask(taskDir);
    const workflow = task.meta.workflow;
    if (!workflow) {
      throw new Error("workflow metadata was not recorded");
    }

    expect(approval.status).toBe(0);
    expect(start.status).toBe(0);
    expect(task.status).toBe("in_progress");
    expect(workflow.schemaVersion).toBe(1);
    expect(workflow.mode).toBe("strict");
    expect(workflow.complexity).toBe("lightweight");
    expect(workflow.revision).toBe(2);
    expect(workflow.artifacts["prd.md"]).toMatch(/^[a-f0-9]{64}$/);
    expect(workflow.approvals).toHaveLength(1);
    expect(workflow.approvals[0].artifacts).toEqual(workflow.artifacts);
  });

  it("invalidates approval when a planning artifact changes", () => {
    const taskDir = setupRepo(root, "strict");
    expect(runTask(root, "approve", "07-24-gated-task").status).toBe(0);
    fs.appendFileSync(path.join(taskDir, "prd.md"), "\nChanged after review.\n");

    const start = runTask(root, "start", "07-24-gated-task");

    expect(start.status).toBe(1);
    expect(start.stderr).toContain("changed after implementation approval");
    expect(readTask(taskDir).status).toBe("planning");
  });

  it("requires both technical artifacts for an explicit complex approval", () => {
    const taskDir = setupRepo(root, "strict");
    fs.writeFileSync(path.join(taskDir, "design.md"), "# Design\n");

    const incomplete = runTask(
      root,
      "approve",
      "07-24-gated-task",
      "--complex",
    );
    fs.writeFileSync(path.join(taskDir, "implement.md"), "# Plan\n");
    const complete = runTask(
      root,
      "approve",
      "07-24-gated-task",
      "--complex",
    );

    expect(incomplete.status).toBe(1);
    expect(incomplete.stderr).toContain("implement.md is missing or empty");
    expect(complete.status).toBe(0);
    expect(readTask(taskDir).meta.workflow.complexity).toBe("complex");
  });

  it("warn mode reports violations but preserves compatible start behavior", () => {
    const taskDir = setupRepo(root, "warn");

    const result = runTask(root, "start", "07-24-gated-task");

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("Warning: workflow gate");
    expect(readTask(taskDir).status).toBe("in_progress");
  });

  it("off mode preserves legacy task metadata", () => {
    const taskDir = setupRepo(root, "off");

    const result = runTask(root, "start", "07-24-gated-task");
    const task = readTask(taskDir);

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("workflow gate");
    expect(task.status).toBe("in_progress");
    expect(task.meta).toEqual({});
  });

  it("refuses a concurrent transition while the task lock is held", () => {
    const taskDir = setupRepo(root, "warn");
    fs.writeFileSync(path.join(taskDir, ".task.json.workflow.lock"), "other");

    const result = runTask(root, "start", "07-24-gated-task");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("workflow transition is already running");
    expect(readTask(taskDir).status).toBe("planning");
  });
});
