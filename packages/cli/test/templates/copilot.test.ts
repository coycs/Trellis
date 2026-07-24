import { describe, expect, it } from "vitest";
import {
  COPILOT_INSTRUCTIONS_PATH,
  getCopilotInstructions,
  getHooksConfig,
} from "../../src/templates/copilot/index.js";

describe("Copilot templates", () => {
  it("delegates session and workflow hooks to the Trellis CLI", () => {
    const raw = getHooksConfig();
    const parsed = JSON.parse(raw) as {
      hooks: {
        SessionStart: { command: string }[];
        userPromptSubmitted: { bash: string; powershell: string }[];
      };
    };
    expect(parsed.hooks.SessionStart[0]?.command).toBe(
      "trellis hook session --platform copilot",
    );
    expect(parsed.hooks.userPromptSubmitted[0]?.bash).toBe(
      "trellis hook workflow --platform copilot",
    );
    expect(parsed.hooks.userPromptSubmitted[0]?.powershell).toBe(
      "trellis hook workflow --platform copilot",
    );
  });

  it("keeps repository guidance declarative", () => {
    expect(COPILOT_INSTRUCTIONS_PATH).toBe(".github/copilot-instructions.md");
    expect(getCopilotInstructions()).not.toContain(".trellis/scripts");
  });
});
