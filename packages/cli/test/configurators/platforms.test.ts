import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PLATFORM_IDS,
  collectPlatformTemplates,
  configurePlatform,
  getConfiguredPlatforms,
} from "../../src/configurators/index.js";
import { AI_TOOLS } from "../../src/types/ai-tools.js";

function files(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(target);
      else out.push(path.relative(root, target).replaceAll("\\", "/"));
    }
  };
  visit(root);
  return out;
}

describe("platform configurators", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "trellis-platform-"));
    process.env.TRELLIS_QUIET = "1";
  });

  afterEach(() => {
    delete process.env.TRELLIS_QUIET;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("configures every registered platform", async () => {
    for (const platform of PLATFORM_IDS) {
      const target = path.join(root, platform);
      fs.mkdirSync(target);
      await expect(
        configurePlatform(platform, target),
      ).resolves.toBeUndefined();
      expect(
        fs.existsSync(path.join(target, AI_TOOLS[platform].configDir)),
        platform,
      ).toBe(true);
    }
  });

  it("writes every collected template byte-for-byte", async () => {
    for (const platform of PLATFORM_IDS) {
      const target = path.join(root, platform);
      fs.mkdirSync(target);
      await configurePlatform(platform, target);
      for (const [relativePath, expected] of collectPlatformTemplates(
        platform,
      ) ?? []) {
        const file = path.join(target, ...relativePath.split("/"));
        expect(fs.existsSync(file), `${platform}: ${relativePath}`).toBe(true);
        expect(
          fs.readFileSync(file, "utf8"),
          `${platform}: ${relativePath}`,
        ).toBe(expected);
      }
    }
  });

  it("never generates Python runtime files", async () => {
    for (const platform of PLATFORM_IDS) {
      const target = path.join(root, platform);
      fs.mkdirSync(target);
      await configurePlatform(platform, target);
      expect(
        files(target).filter((file) => file.endsWith(".py")),
        platform,
      ).toEqual([]);
    }
  });

  it("detects configured platforms from their owned roots", async () => {
    await configurePlatform("codex", root);
    await configurePlatform("claude-code", root);
    expect(new Set(getConfiguredPlatforms(root))).toEqual(
      new Set(["claude-code", "codex"]),
    );
  });
});
