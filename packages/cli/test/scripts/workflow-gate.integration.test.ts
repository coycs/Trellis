import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerTaskCommand } from "../../src/commands/task.js";

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

async function run(root: string, ...args: string[]): Promise<Error | null> {
  const previous = process.cwd();
  process.chdir(root);
  try {
    const program = new Command().exitOverride();
    registerTaskCommand(program);
    await program.parseAsync(["task", ...args], { from: "user" });
    return null;
  } catch (error) {
    return error as Error;
  } finally {
    process.chdir(previous);
  }
}

function taskDir(root: string): string {
  const tasks = path.join(root, ".trellis", "tasks");
  const name = fs.readdirSync(tasks).find((entry) => entry !== "archive");
  if (!name) throw new Error("task missing");
  return path.join(tasks, name);
}

function data(root: string): any {
  return JSON.parse(
    fs.readFileSync(path.join(taskDir(root), "task.json"), "utf8"),
  );
}

describe("strict TypeScript task lifecycle", () => {
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-lifecycle-"));
    fs.mkdirSync(path.join(root, ".trellis"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".trellis", "workflow.md"),
      "# Workflow\n",
    );
    fs.writeFileSync(path.join(root, "source.txt"), "v1\n");
    git(root, "init");
    git(root, "config", "user.email", "test@example.com");
    git(root, "config", "user.name", "Test");
    git(root, "add", ".");
    git(root, "commit", "-m", "initial");
    process.env.TRELLIS_CONTEXT_ID = "test";
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      await run(root, "create", "Lifecycle", "--slug", "lifecycle"),
    ).toBeNull();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.TRELLIS_CONTEXT_ID;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("blocks start without approval", async () => {
    expect(await run(root, "start", taskDir(root))).toBeInstanceOf(Error);
    expect(data(root).status).toBe("planning");
  });

  it("binds approval to artifact content", async () => {
    const task = taskDir(root);
    expect(await run(root, "approve", task)).toBeNull();
    fs.appendFileSync(path.join(task, "prd.md"), "changed\n");
    expect(await run(root, "start", task)).toBeInstanceOf(Error);
  });

  it("requires all complex planning artifacts", async () => {
    const task = taskDir(root);
    expect(await run(root, "approve", task, "--complex")).toBeInstanceOf(Error);
    fs.writeFileSync(path.join(task, "design.md"), "# Design\n");
    fs.writeFileSync(path.join(task, "implement.md"), "# Plan\n");
    expect(await run(root, "approve", task, "--complex")).toBeNull();
  });

  it("records passing evidence for the current commit", async () => {
    const task = taskDir(root);
    await run(root, "approve", task);
    await run(root, "start", task);
    fs.writeFileSync(path.join(root, "source.txt"), "v2\n");
    git(root, "add", "source.txt");
    git(root, "commit", "-m", "implementation");

    expect(
      await run(
        root,
        "review",
        task,
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ),
    ).toBeNull();
    expect(data(root).meta.workflow.evidence[0].commit).toBe(
      git(root, "rev-parse", "HEAD"),
    );
  });

  it("rejects review on a dirty product worktree", async () => {
    const task = taskDir(root);
    await run(root, "approve", task);
    await run(root, "start", task);
    fs.writeFileSync(path.join(root, "source.txt"), "dirty\n");
    expect(
      await run(
        root,
        "review",
        task,
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ),
    ).toBeInstanceOf(Error);
  });

  it("ignores task state for a Trellis project nested in a Git repository", async () => {
    const app = path.join(root, "apps", "demo");
    fs.mkdirSync(path.join(app, ".trellis"), { recursive: true });
    fs.writeFileSync(path.join(app, ".trellis", "workflow.md"), "# Workflow\n");
    fs.writeFileSync(path.join(app, "source.txt"), "nested\n");
    git(root, "add", "apps/demo/source.txt");
    git(root, "commit", "-m", "nested app");

    await run(app, "create", "Nested", "--slug", "nested");
    const task = taskDir(app);
    await run(app, "approve", task);
    await run(app, "start", task);

    expect(
      await run(
        app,
        "review",
        task,
        "--",
        process.execPath,
        "-e",
        "process.exit(0)",
      ),
    ).toBeNull();
  });

  it("archives only fresh reviewed work", async () => {
    const task = taskDir(root);
    await run(root, "approve", task);
    await run(root, "start", task);
    fs.writeFileSync(path.join(root, "source.txt"), "v2\n");
    git(root, "add", "source.txt");
    git(root, "commit", "-m", "implementation");
    await run(
      root,
      "review",
      task,
      "--",
      process.execPath,
      "-e",
      "process.exit(0)",
    );
    expect(await run(root, "archive", task)).toBeNull();

    const month = fs.readdirSync(
      path.join(root, ".trellis", "tasks", "archive"),
    )[0];
    expect(month).toBeDefined();
    const archived = path.join(
      root,
      ".trellis",
      "tasks",
      "archive",
      month!,
      path.basename(task),
      "task.json",
    );
    expect(JSON.parse(fs.readFileSync(archived, "utf8")).status).toBe(
      "completed",
    );
  });
});
