import { describe, expect, it } from "vitest";
import {
  getAllAgents,
  getSettingsTemplate,
} from "../../src/templates/trae/index.js";

describe("Trae templates", () => {
  it("ships the three role agents", () => {
    expect(
      getAllAgents()
        .map((agent) => agent.name)
        .sort(),
    ).toEqual(["trellis-check", "trellis-implement", "trellis-research"]);
  });

  it("delegates session and workflow hooks to the CLI", () => {
    const config = getSettingsTemplate();
    expect(config.content).toContain("trellis hook session --platform trae");
    expect(config.content).toContain("trellis hook workflow --platform trae");
    expect(config.content).not.toContain(".py");
  });
});
