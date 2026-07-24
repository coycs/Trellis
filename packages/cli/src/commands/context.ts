import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { loadTaskRecord } from "@mindfoldhq/trellis-core/task";
import { currentTask } from "./task.js";

function root(): string {
  let current = process.cwd();
  while (!fs.existsSync(path.join(current, ".trellis"))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("not inside a Trellis project");
    current = parent;
  }
  return current;
}

function section(text: string, start: RegExp, end: RegExp): string {
  const from = text.search(start);
  if (from < 0) return "";
  const tail = text.slice(from);
  const match = tail.slice(1).search(end);
  return match < 0 ? tail.trim() : tail.slice(0, match + 1).trim();
}

function platformFilter(text: string, platform?: string): string {
  if (!platform) return text;
  const needle = platform.replace(/[-_ ]/g, "").toLowerCase();
  let keep = true;
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const marker = line.match(/^\[(\/?)([A-Za-z][^[\]]*)\]$/);
      if (!marker) return keep;
      keep =
        marker[1] === "/"
          ? true
          : marker[2]
              .split(",")
              .some(
                (name) =>
                  name.trim().replace(/[-_ ]/g, "").toLowerCase() === needle,
              );
      return false;
    })
    .join("\n")
    .trim();
}

export function workflowState(cwd = root()): {
  status: string;
  task: string | null;
  body: string;
} {
  const task = currentTask(cwd);
  let status = "no_task";
  if (task) {
    try {
      status = loadTaskRecord({ taskDir: task, cwd }).status;
    } catch {
      status = "no_task";
    }
  }
  const markdown = fs.readFileSync(
    path.join(cwd, ".trellis", "workflow.md"),
    "utf8",
  );
  const pattern = new RegExp(
    `\\[workflow-state:${status}\\]\\s*\\n([\\s\\S]*?)\\n\\s*\\[/workflow-state:${status}\\]`,
  );
  const body =
    markdown.match(pattern)?.[1]?.trim() ??
    "Refer to workflow.md for current step.";
  return { status, task, body };
}

function packages(cwd: string): string {
  const spec = path.join(cwd, ".trellis", "spec");
  if (!fs.existsSync(spec)) return "No project specs.";
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith(".md")) {
        files.push(
          `.trellis/spec/${path.relative(spec, target).replaceAll("\\", "/")}`,
        );
      }
    }
  };
  visit(spec);
  return files.sort().join("\n");
}

function render(options: {
  mode?: string;
  step?: string;
  platform?: string;
}): void {
  const cwd = root();
  const markdown = fs.readFileSync(
    path.join(cwd, ".trellis", "workflow.md"),
    "utf8",
  );
  if (options.mode === "packages") {
    console.log(packages(cwd));
    return;
  }
  if (options.mode === "phase") {
    const content = options.step
      ? section(
          markdown,
          new RegExp(`^####\\s+${options.step.replace(".", "\\.")}\\b`, "m"),
          /^(?:####|##)\s|^---$/m,
        )
      : section(markdown, /^## Phase Index$/m, /^## Phase 1:/m);
    console.log(platformFilter(content, options.platform));
    return;
  }
  const state = workflowState(cwd);
  console.log(
    `Task: ${state.task ?? "(none)"}\nStatus: ${state.status}\n\n${state.body}`,
  );
}

export function registerContextCommand(program: Command): void {
  program
    .command("context")
    .description("Print current Trellis workflow context")
    .option("--mode <mode>", "phase | packages")
    .option("--step <id>")
    .option("--platform <platform>")
    .action(render);
}
