import { describe, expect, it } from "vitest";
import {
  settingsTemplate,
  getAllAgents,
  getSettingsTemplate,
} from "../../src/templates/claude/index.js";

// =============================================================================
// settingsTemplate — module-level constant
// =============================================================================

describe("settingsTemplate", () => {
  it("is valid JSON", () => {
    expect(() => JSON.parse(settingsTemplate)).not.toThrow();
  });

  it("is a non-empty string", () => {
    expect(settingsTemplate.length).toBeGreaterThan(0);
  });

  // v0.5.0-beta.8: pin CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1 at the project
  // level so Bash tool cwd changes don't leak into subsequent hook invocations.
  // Without this, a user who runs `cd frontend/` via Bash tool leaves cwd stuck
  // in `frontend/`, leaving later project commands in the wrong directory.
  it("sets CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1 in env", () => {
    const settings = JSON.parse(settingsTemplate) as {
      env?: Record<string, string>;
    };
    expect(settings.env?.CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR).toBe("1");
  });
});

// =============================================================================
// settingsTemplate — SessionStart hook matchers
// =============================================================================

describe("settingsTemplate SessionStart matchers", () => {
  const settings = JSON.parse(settingsTemplate);
  const sessionStartEntries = settings.hooks.SessionStart as {
    matcher: string;
    hooks: { type: string; command: string; timeout: number }[];
  }[];

  it("includes startup, clear, and compact matchers", () => {
    const matchers = sessionStartEntries.map((e) => e.matcher);
    expect(matchers).toContain("startup");
    expect(matchers).toContain("clear");
    expect(matchers).toContain("compact");
  });

  it("all SessionStart entries invoke the central session hook", () => {
    for (const entry of sessionStartEntries) {
      expect(entry.hooks).toHaveLength(1);
      expect(entry.hooks[0].command).toBe(
        "trellis hook session --platform claude",
      );
    }
  });

  it("contains no project-local hook path", () => {
    for (const entry of sessionStartEntries) {
      expect(entry.hooks[0].command).not.toContain(".claude/hooks");
    }
  });
});

// Commands are now sourced from common/ templates and tested in platforms.test.ts

// =============================================================================
// getAllAgents — reads agent templates
// =============================================================================

describe("getAllAgents", () => {
  it("each agent has name and content", () => {
    const agents = getAllAgents();
    for (const agent of agents) {
      expect(agent.name.length).toBeGreaterThan(0);
      expect(agent.content.length).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// getSettingsTemplate — returns settings as SettingsTemplate
// =============================================================================

describe("getSettingsTemplate", () => {
  it("returns correct shape with valid JSON", () => {
    const result = getSettingsTemplate();
    expect(result.targetPath).toBe("settings.json");
    expect(result.content.length).toBeGreaterThan(0);
    expect(() => JSON.parse(result.content)).not.toThrow();
  });
});
