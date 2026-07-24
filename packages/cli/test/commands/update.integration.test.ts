import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { init } from "../../src/commands/init.js";
import { update } from "../../src/commands/update.js";
import { VERSION } from "../../src/constants/version.js";
import { computeHash } from "../../src/utils/template-hash.js";

vi.mock("figlet", () => ({
  default: { textSync: vi.fn(() => "TRELLIS") },
}));

vi.mock("inquirer", () => ({
  default: { prompt: vi.fn().mockResolvedValue({ action: "overwrite" }) },
}));

describe("update", () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    cwd = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-update-"));
    process.chdir(cwd);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ version: VERSION }),
      }),
    );
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await init({ yes: true, codex: true, force: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  it("keeps an initialized project current", async () => {
    await update({ force: true });

    const hooks = fs.readFileSync(
      path.join(cwd, ".codex", "hooks.json"),
      "utf8",
    );
    expect(hooks).toContain("trellis hook");
    expect(hooks).not.toContain(".py");
  });

  it("removes hash-tracked legacy Python runtime", async () => {
    const files = [".trellis/scripts/task.py", ".codex/hooks/session-start.py"];
    for (const file of files) {
      const target = path.join(cwd, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, "# legacy\n");
    }

    const manifestPath = path.join(cwd, ".trellis", ".template-hashes.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as {
      hashes: Record<string, string>;
    };
    for (const file of files) manifest.hashes[file] = computeHash("# legacy\n");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await update({ force: true });

    for (const file of files)
      expect(fs.existsSync(path.join(cwd, file))).toBe(false);
    const generated = fs
      .readdirSync(cwd, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith(".py"));
    expect(generated).toEqual([]);
  });

  it("preserves untracked user files", async () => {
    const custom = path.join(cwd, ".codex", "hooks", "custom.ts");
    fs.mkdirSync(path.dirname(custom), { recursive: true });
    fs.writeFileSync(custom, "export {};\n");

    await update({ force: true });

    expect(fs.readFileSync(custom, "utf8")).toBe("export {};\n");
  });

  it("does not mutate files in dry-run mode", async () => {
    const hooks = path.join(cwd, ".codex", "hooks.json");
    fs.writeFileSync(hooks, "{}\n");

    await update({ force: true, dryRun: true });

    expect(fs.readFileSync(hooks, "utf8")).toBe("{}\n");
  });
});
