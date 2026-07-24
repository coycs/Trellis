import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

function templatePath(name: string): string {
  const target = path.join(root, name);
  if (!fs.existsSync(target)) throw new Error(`Missing ${name} templates`);
  return target;
}

export const getClaudeTemplatePath = (): string => templatePath("claude");
export const getOpenCodeTemplatePath = (): string => templatePath("opencode");
