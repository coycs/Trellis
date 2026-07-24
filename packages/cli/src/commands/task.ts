import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { Command } from "commander";
import {
  emptyTaskRecord,
  loadTaskRecord,
  writeTaskRecord,
  type TrellisTaskRecord,
} from "@mindfoldhq/trellis-core/task";

interface Evidence {
  type: "test";
  command: string[];
  commit: string;
  revision: number;
  passedAt: string;
}

interface WorkflowMeta {
  revision: number;
  complexity?: "lightweight" | "complex";
  approval?: { approvedAt: string; artifacts: Record<string, string> };
  evidence?: Evidence[];
}

const TASKS = path.join(".trellis", "tasks");
const SESSIONS = path.join(".trellis", ".runtime", "sessions");

function root(cwd = process.cwd()): string {
  let current = path.resolve(cwd);
  while (!fs.existsSync(path.join(current, ".trellis"))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("not inside a Trellis project");
    current = parent;
  }
  return current;
}

function taskDir(ref: string, cwd = root()): string {
  const direct = path.resolve(cwd, ref);
  if (fs.existsSync(path.join(direct, "task.json"))) return direct;
  return path.join(cwd, TASKS, path.basename(ref));
}

function taskRef(dir: string, cwd = root()): string {
  return path.relative(cwd, dir).replaceAll("\\", "/");
}

function workflow(record: TrellisTaskRecord): WorkflowMeta {
  const value = record.meta.workflow;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { revision: 0 };
  }
  return {
    ...(value as WorkflowMeta),
    revision: (value as WorkflowMeta).revision ?? 0,
  };
}

function updateWorkflow(
  record: TrellisTaskRecord,
  value: WorkflowMeta,
): TrellisTaskRecord {
  return { ...record, meta: { ...record.meta, workflow: value } };
}

function hash(file: string): string {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

function artifacts(dir: string, complex: boolean): Record<string, string> {
  const names = complex ? ["prd.md", "design.md", "implement.md"] : ["prd.md"];
  return Object.fromEntries(
    names.map((name) => {
      const file = path.join(dir, name);
      if (!fs.existsSync(file))
        throw new Error(`missing planning artifact: ${name}`);
      return [name, hash(file)];
    }),
  );
}

function sameArtifacts(dir: string, expected: Record<string, string>): boolean {
  return Object.entries(expected).every(
    ([name, digest]) =>
      fs.existsSync(path.join(dir, name)) &&
      hash(path.join(dir, name)) === digest,
  );
}

function sessionKey(): string {
  const direct = process.env.TRELLIS_CONTEXT_ID?.trim();
  if (direct) return direct.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160);
  const pairs = [
    ["codex", process.env.CODEX_THREAD_ID ?? process.env.CODEX_SESSION_ID],
    [
      "claude",
      process.env.CLAUDE_SESSION_ID ?? process.env.CLAUDE_CODE_SESSION_ID,
    ],
    ["cursor", process.env.CURSOR_SESSION_ID],
    [
      "opencode",
      process.env.OPENCODE_SESSION_ID ?? process.env.OPENCODE_RUN_ID,
    ],
    ["copilot", process.env.COPILOT_SESSION_ID],
    ["snow", process.env.SNOW_SESSION_ID],
  ] as const;
  const pair = pairs.find(([, value]) => value?.trim());
  const value = pair?.[1]?.trim();
  if (!pair || !value) throw new Error("session identity is required");
  return `${pair[0]}_${value.replace(/[^A-Za-z0-9._-]/g, "_")}`.slice(0, 160);
}

function sessionFile(cwd = root()): string {
  return path.join(cwd, SESSIONS, `${sessionKey()}.json`);
}

function setCurrent(ref: string, cwd = root()): void {
  const file = sessionFile(cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    `${JSON.stringify({ task: ref, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

export function currentTask(cwd = root()): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(sessionFile(cwd), "utf8")) as {
      task?: unknown;
    };
    return typeof data.task === "string" ? data.task : null;
  } catch {
    return null;
  }
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || "git failed");
  return result.stdout.trim();
}

function optionalGit(cwd: string, args: string[]): string {
  try {
    return git(cwd, args);
  } catch {
    return "";
  }
}

function assertClean(cwd: string): void {
  const dirty = git(cwd, ["status", "--porcelain"])
    .split(/\r?\n/)
    .filter((line) => {
      if (!line) return false;
      const file = line.slice(3).replaceAll("\\", "/");
      return (
        file !== ".trellis" &&
        !file.startsWith(".trellis/") &&
        !file.includes("/.trellis/")
      );
    });
  if (dirty.length)
    throw new Error(`working tree is dirty:\n${dirty.join("\n")}`);
}

function create(
  title: string,
  options: {
    slug?: string;
    description?: string;
    assignee?: string;
    noStart?: boolean;
  },
): void {
  const cwd = root();
  const slug = (options.slug ?? title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) throw new Error("slug is required");
  const day = new Date().toISOString().slice(5, 10);
  const name = `${day}-${slug}`;
  const dir = path.join(cwd, TASKS, name);
  if (fs.existsSync(dir)) throw new Error(`task already exists: ${name}`);
  const owner =
    options.assignee ??
    process.env.USER ??
    process.env.USERNAME ??
    optionalGit(cwd, ["config", "user.name"]);
  const record = emptyTaskRecord({
    id: slug,
    name: slug,
    title,
    description: options.description ?? "",
    creator: owner,
    assignee: owner,
    base_branch: git(cwd, ["branch", "--show-current"]) || null,
    meta: { workflow: { revision: 0, evidence: [] } },
  });
  writeTaskRecord({ taskDir: dir, record });
  fs.writeFileSync(
    path.join(dir, "prd.md"),
    `# ${title}\n\n## Goal\n\n${options.description ?? ""}\n\n## Acceptance Criteria\n\n- [ ] Define the expected outcome.\n`,
  );
  if (!options.noStart) setCurrent(taskRef(dir, cwd), cwd);
  console.log(taskRef(dir, cwd));
}

function approve(ref: string, complex: boolean): void {
  const dir = taskDir(ref);
  const record = loadTaskRecord({ taskDir: dir });
  if (record.status !== "planning")
    throw new Error("approve requires planning");
  const state = workflow(record);
  const next = updateWorkflow(record, {
    ...state,
    revision: state.revision + 1,
    complexity: complex ? "complex" : "lightweight",
    approval: {
      approvedAt: new Date().toISOString(),
      artifacts: artifacts(dir, complex),
    },
    evidence: [],
  });
  writeTaskRecord({ taskDir: dir, record: next });
  console.log(`approved revision ${workflow(next).revision}`);
}

function start(ref: string): void {
  const cwd = root();
  const dir = taskDir(ref, cwd);
  const record = loadTaskRecord({ taskDir: dir });
  if (record.status === "planning") {
    const state = workflow(record);
    if (!state.approval || !sameArtifacts(dir, state.approval.artifacts)) {
      throw new Error(
        "planning artifacts are not approved or changed after approval",
      );
    }
    writeTaskRecord({
      taskDir: dir,
      record: updateWorkflow(
        { ...record, status: "in_progress" },
        { ...state, revision: state.revision + 1, evidence: [] },
      ),
    });
  } else if (!["in_progress", "review"].includes(record.status)) {
    throw new Error(`cannot start task in status ${record.status}`);
  }
  setCurrent(taskRef(dir, cwd), cwd);
  console.log(taskRef(dir, cwd));
}

function review(ref: string, command: string[]): void {
  const cwd = root();
  const dir = taskDir(ref, cwd);
  const record = loadTaskRecord({ taskDir: dir });
  if (record.status !== "in_progress")
    throw new Error("review requires in_progress");
  if (!command.length) throw new Error("review requires a test command");
  assertClean(cwd);
  const state = workflow(record);
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0)
    throw new Error(`test command failed (${result.status})`);
  assertClean(cwd);
  const evidence: Evidence = {
    type: "test",
    command,
    commit: git(cwd, ["rev-parse", "HEAD"]),
    revision: state.revision,
    passedAt: new Date().toISOString(),
  };
  writeTaskRecord({
    taskDir: dir,
    record: updateWorkflow(
      { ...record, status: "review" },
      {
        ...state,
        revision: state.revision + 1,
        evidence: [...(state.evidence ?? []), evidence],
      },
    ),
  });
  console.log("review passed");
}

function archive(ref: string): void {
  const cwd = root();
  const dir = taskDir(ref, cwd);
  const record = loadTaskRecord({ taskDir: dir });
  const state = workflow(record);
  const evidence = state.evidence?.at(-1);
  if (record.status !== "review") throw new Error("archive requires review");
  if (
    evidence?.commit !== git(cwd, ["rev-parse", "HEAD"]) ||
    evidence?.revision !== state.revision - 1
  ) {
    throw new Error(
      "archive requires fresh passing evidence for the current commit",
    );
  }
  const completed = updateWorkflow(
    {
      ...record,
      status: "completed",
      completedAt: new Date().toISOString().slice(0, 10),
    },
    { ...state, revision: state.revision + 1 },
  );
  writeTaskRecord({ taskDir: dir, record: completed });
  const target = path.join(
    cwd,
    TASKS,
    "archive",
    new Date().toISOString().slice(0, 7),
    path.basename(dir),
  );
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.renameSync(dir, target);
  const sessions = path.join(cwd, SESSIONS);
  if (fs.existsSync(sessions)) {
    for (const name of fs.readdirSync(sessions)) {
      const file = path.join(sessions, name);
      try {
        const data = JSON.parse(fs.readFileSync(file, "utf8")) as {
          task?: unknown;
        };
        if (data.task === taskRef(dir, cwd)) fs.rmSync(file);
      } catch {
        // Ignore unrelated or corrupt session files.
      }
    }
  }
  console.log(taskRef(target, cwd));
}

function list(json: boolean): void {
  const cwd = root();
  const dir = path.join(cwd, TASKS);
  const tasks = fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "archive")
        .map((entry) => ({
          dir: `${TASKS}/${entry.name}`.replaceAll("\\", "/"),
          ...loadTaskRecord({ taskDir: path.join(dir, entry.name) }),
        }))
    : [];
  if (json) console.log(JSON.stringify({ tasks }));
  else
    tasks.forEach((task) =>
      console.log(`${task.dir}  ${task.status}  ${task.title}`),
    );
}

function current(source: boolean, json: boolean): void {
  const cwd = root();
  const ref = currentTask(cwd);
  if (json) {
    const task = ref ? loadTaskRecord({ taskDir: taskDir(ref, cwd) }) : null;
    console.log(
      JSON.stringify({ current_task: task && { dir: ref, ...task } }),
    );
    return;
  }
  console.log(source ? `Current task: ${ref ?? "(none)"}` : (ref ?? ""));
}

export function registerTaskCommand(program: Command): void {
  const task = program
    .command("task")
    .description("Strict Trellis task lifecycle");
  task
    .command("create <title>")
    .option("--slug <slug>")
    .option("--description <text>")
    .option("--assignee <name>")
    .option("--no-start")
    .action(create);
  task
    .command("approve <task>")
    .option("--complex")
    .action((ref, opts) => approve(ref, !!opts.complex));
  task.command("start <task>").action(start);
  task.command("review <task> <command...>").action(review);
  task.command("archive <task>").action(archive);
  task
    .command("current")
    .option("--source")
    .option("--json")
    .action((opts) => current(!!opts.source, !!opts.json));
  task
    .command("list")
    .option("--json")
    .action((opts) => list(!!opts.json));
}
