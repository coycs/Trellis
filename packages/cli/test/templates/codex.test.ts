import { describe, expect, it } from "vitest";
import {
  getAllAgents,
  getConfigTemplate,
  getHooksConfig,
} from "../../src/templates/codex/index.js";

describe("Codex templates", () => {
  it("ships the three role agents", () => {
    expect(
      getAllAgents()
        .map((agent) => agent.name)
        .sort(),
    ).toEqual(["trellis-check", "trellis-implement", "trellis-research"]);
  });

  it("agents contain a guarded active-task fallback", () => {
    for (const agent of getAllAgents()) {
      expect(agent.content).toContain("<!-- trellis-hook-injected -->");
      expect(agent.content).toContain("Active task:");
      expect(agent.content).not.toContain(".trellis/scripts");
    }
  });

  it("delegates workflow and sub-agent context to the CLI", () => {
    const raw = getHooksConfig();
    expect(raw).toContain("trellis hook workflow --platform codex");
    expect(raw).toContain("trellis hook subagent --platform codex");
    expect(raw).not.toContain(".py");
  });

  it("scopes SubagentStart to Trellis roles", () => {
    const config = JSON.parse(getHooksConfig()) as {
      hooks: Record<string, { matcher?: string }[]>;
    };
    const matcher = new RegExp(config.hooks.SubagentStart?.[0]?.matcher ?? "");
    expect(matcher.test("trellis-implement")).toBe(true);
    expect(matcher.test("trellis-check")).toBe(true);
    expect(matcher.test("trellis-research")).toBe(true);
    expect(matcher.test("other")).toBe(false);
  });

  it("keeps project config recursion-safe", () => {
    const config = getConfigTemplate();
    expect(config.targetPath).toBe("config.toml");
    expect(config.content).toMatch(/\[agents\]\r?\nmax_depth = 1/);
    expect(config.content).not.toContain("multi_agent_v2");
  });
});
