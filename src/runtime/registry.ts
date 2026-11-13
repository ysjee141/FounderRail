import { ClaudeRuntimeAdapter } from "./adapters/claude.js";
import { CodexRuntimeAdapter } from "./adapters/codex.js";
import { GeminiRuntimeAdapter } from "./adapters/gemini.js";
import type { RuntimeAdapter, RuntimeName } from "./types.js";

const adapters: Record<RuntimeName, RuntimeAdapter> = {
  claude: new ClaudeRuntimeAdapter(),
  codex: new CodexRuntimeAdapter(),
  gemini: new GeminiRuntimeAdapter(),
};

export function getRuntimeAdapter(name: RuntimeName): RuntimeAdapter {
  return adapters[name];
}

export function getRuntimeAdapters(): RuntimeAdapter[] {
  return Object.values(adapters);
}
