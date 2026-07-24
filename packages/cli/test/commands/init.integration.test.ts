import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("figlet", () => ({
  default: { textSync: vi.fn(() => "TRELLIS") },
}));
vi.mock("inquirer", () => ({
  default: { prompt: vi.fn().mockResolvedValue({}) },
}));
vi.mock("node:child_process", () => ({
  execSync: vi.fn().mockReturnValue(""),
}));

import { init } from "../../src/commands/init.js";

describe("init() TypeScript runtime integration", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-init-"));
    vi.spyOn(process, "cwd").mockReturnValue(root);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("creates state, specs, tasks, and default platforms", async () => {
    await init({ yes: true });
    for (const target of [
      ".trellis/workflow.md",
      ".trellis/config.yaml",
      ".trellis/tasks",
      ".trellis/spec",
      ".claude/settings.json",
      ".cursor/hooks.json",
      "AGENTS.md",
    ]) {
      expect(fs.existsSync(path.join(root, target)), target).toBe(true);
    }
  });

  it("does not generate project-local runtime or journal directories", async () => {
    await init({ yes: true });
    expect(fs.existsSync(path.join(root, ".trellis", "scripts"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".trellis", "workspace"))).toBe(false);
    expect(
      fs
        .readdirSync(root, { recursive: true })
        .some((entry) => String(entry).endsWith(".py")),
    ).toBe(false);
  });

  it("writes direct Codex CLI hook commands", async () => {
    await init({ yes: true, codex: true });
    const hooks = fs.readFileSync(
      path.join(root, ".codex", "hooks.json"),
      "utf8",
    );
    expect(hooks).toContain("trellis hook workflow --platform codex");
    expect(hooks).toContain("trellis hook subagent --platform codex");
    expect(hooks).not.toContain(".py");
  });

  it("writes developer identity without a journal runtime", async () => {
    await init({ yes: true, user: "Ada", codex: true });
    expect(
      fs.readFileSync(path.join(root, ".trellis", ".developer"), "utf8"),
    ).toContain("name=Ada");
    expect(fs.existsSync(path.join(root, ".trellis", "workspace"))).toBe(false);
  });

  it("is idempotent in force mode", async () => {
    await init({ yes: true, codex: true });
    const before = fs.readFileSync(
      path.join(root, ".codex", "hooks.json"),
      "utf8",
    );
    await init({ yes: true, codex: true, force: true });
    expect(
      fs.readFileSync(path.join(root, ".codex", "hooks.json"), "utf8"),
    ).toBe(before);
  });

  it("tracks generated templates", async () => {
    await init({ yes: true, codex: true });
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(root, ".trellis", ".template-hashes.json"),
        "utf8",
      ),
    ) as { hashes: Record<string, string> };
    expect(manifest.hashes).toHaveProperty(".trellis/workflow.md");
    expect(manifest.hashes).toHaveProperty(".codex/hooks.json");
    expect(
      Object.keys(manifest.hashes).some((file) => file.endsWith(".py")),
    ).toBe(false);
  });
});
