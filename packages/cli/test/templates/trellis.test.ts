import { describe, expect, it } from "vitest";
import {
  getAllAgents,
  removedTemplates,
  workflowMdTemplate,
} from "../../src/templates/trellis/index.js";

describe("Trellis TypeScript templates", () => {
  it("ships one strict lifecycle", () => {
    expect(workflowMdTemplate).toContain(
      "`planning → in_progress → review → completed`",
    );
    for (const command of ["create", "approve", "start", "review", "archive"]) {
      expect(workflowMdTemplate).toContain(`trellis task ${command}`);
    }
  });

  it("contains context blocks for every status", () => {
    for (const status of [
      "no_task",
      "planning",
      "in_progress",
      "review",
      "completed",
    ]) {
      expect(workflowMdTemplate).toContain(`[workflow-state:${status}]`);
      expect(workflowMdTemplate).toContain(`[/workflow-state:${status}]`);
    }
  });

  it("does not ship a project-local runtime", () => {
    expect(workflowMdTemplate).toContain("no project-local runtime exists");
    expect(removedTemplates).toContain(".trellis/scripts");
  });

  it("removes every legacy Python hook by explicit path", () => {
    const hooks = removedTemplates.filter((entry) => entry.endsWith(".py"));
    expect(hooks.length).toBeGreaterThan(0);
    expect(hooks.every((entry) => entry.includes("/hooks/"))).toBe(true);
  });

  it("ships channel runtime agent definitions", () => {
    const agents = getAllAgents();
    expect([...agents.keys()]).toEqual(["implement.md", "check.md"]);
    expect([...agents.values()].every((value) => value.length > 0)).toBe(true);
  });
});
