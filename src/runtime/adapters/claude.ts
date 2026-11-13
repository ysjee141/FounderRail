import { BaseRuntimeAdapter } from "../base-adapter.js";
import type { RuntimeInvocation, RuntimeRunRequest } from "../types.js";

export class ClaudeRuntimeAdapter extends BaseRuntimeAdapter {
  readonly name = "claude" as const;
  readonly command = "claude";

  buildInvocation(request: RuntimeRunRequest): RuntimeInvocation {
    const structuredOutputArgs = request.outputSchema
      ? ["--json-schema", JSON.stringify(request.outputSchema.schema)]
      : [];
    return {
      command: this.command,
      args: [
        "-p",
        request.prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--safe-mode",
        "--no-session-persistence",
        "--permission-prompts",
        "none",
        "--permission-mode",
        request.mode === "read-only" ? "plan" : "acceptEdits",
        ...structuredOutputArgs,
      ],
    };
  }
}
