/**
 * Copilot templates
 *
 * These are GENERIC templates for user projects.
 *
 * Directory structure:
 *   copilot/
 *   ├── prompts/         # Slash-command prompts → .github/prompts/*.prompt.md
 *   ├── hooks.json       # Hooks config → .github/hooks/trellis.json
 *   └── copilot-instructions.md → .github/copilot-instructions.md
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const COPILOT_INSTRUCTIONS_PATH = ".github/copilot-instructions.md";
export const COPILOT_INSTRUCTIONS_BLOCK_START =
  "<!-- TRELLIS:COPILOT-GUIDANCE:START -->";
export const COPILOT_INSTRUCTIONS_BLOCK_END =
  "<!-- TRELLIS:COPILOT-GUIDANCE:END -->";

function readTemplate(relativePath: string): string {
  return readFileSync(join(__dirname, relativePath), "utf-8");
}

export function getHooksConfig(): string {
  return readTemplate("hooks.json");
}

export function getCopilotInstructions(): string {
  return readTemplate("copilot-instructions.md");
}
