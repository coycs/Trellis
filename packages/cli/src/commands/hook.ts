import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { workflowState } from "./context.js";

function root(): string {
  let current = process.cwd();
  while (!fs.existsSync(path.join(current, ".trellis"))) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error("not inside a Trellis project");
    current = parent;
  }
  return current;
}

function readInput(): Record<string, unknown> {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(fs.readFileSync(0, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function subagentContext(task: string | null): string {
  const marker = "<!-- trellis-hook-injected -->";
  if (!task) return marker;
  const cwd = root();
  const dir = path.resolve(cwd, task);
  const chunks = ["prd.md", "design.md", "implement.md"]
    .filter((name) => fs.existsSync(path.join(dir, name)))
    .map(
      (name) =>
        `## ${name}\n\n${fs.readFileSync(path.join(dir, name), "utf8").trim()}`,
    );
  for (const manifest of ["implement.jsonl", "check.jsonl"]) {
    const file = path.join(dir, manifest);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      try {
        const row = JSON.parse(line) as { file?: unknown };
        if (typeof row.file !== "string") continue;
        const target = path.resolve(cwd, row.file);
        if (fs.existsSync(target)) {
          chunks.push(
            `## ${row.file}\n\n${fs.readFileSync(target, "utf8").trim()}`,
          );
        }
      } catch {
        // Ignore seed and malformed rows.
      }
    }
  }
  return `${marker}\n\n${chunks.join("\n\n---\n\n")}`;
}

function output(platform: string, event: string, content: string): void {
  if (platform === "kiro") {
    console.log(content);
    return;
  }
  if (platform === "cursor") {
    console.log(JSON.stringify({ additional_context: content }));
    return;
  }
  const hookEventName =
    platform === "gemini"
      ? "BeforeAgent"
      : event === "session"
        ? "SessionStart"
        : event === "subagent"
          ? "SubagentStart"
          : "UserPromptSubmit";
  console.log(
    JSON.stringify({
      hookSpecificOutput: { hookEventName, additionalContext: content },
    }),
  );
}

function run(event: string, options: { platform?: string }): void {
  readInput();
  const state = workflowState();
  const content =
    event === "subagent"
      ? subagentContext(state.task)
      : `<workflow-state status="${state.status}" task="${state.task ?? ""}">\n${state.body}\n</workflow-state>`;
  output(options.platform ?? "claude", event, content);
}

export function registerHookCommand(program: Command): void {
  program
    .command("hook <event>")
    .description("Emit platform hook context")
    .option("--platform <platform>")
    .action(run);
}
