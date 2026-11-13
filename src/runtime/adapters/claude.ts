import { BaseRuntimeAdapter } from "../base-adapter.js";
import type { RuntimeInvocation, RuntimeRunRequest } from "../types.js";

export class ClaudeRuntimeAdapter extends BaseRuntimeAdapter {
  readonly name = "claude" as const;
  readonly command = "claude";

  buildInvocation(request: RuntimeRunRequest): RuntimeInvocation {
    return {
      command: this.command,
      args: [
        "-p",
        request.prompt,
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        request.mode === "read-only" ? "plan" : "acceptEdits",
      ],
    };
  }
}
