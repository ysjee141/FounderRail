import { BaseRuntimeAdapter } from "../base-adapter.js";
import type { RuntimeInvocation, RuntimeRunRequest } from "../types.js";

export class GeminiRuntimeAdapter extends BaseRuntimeAdapter {
  readonly name = "gemini" as const;
  readonly command = "gemini";

  buildInvocation(request: RuntimeRunRequest): RuntimeInvocation {
    return {
      command: this.command,
      args: [
        "-p",
        request.prompt,
        "--output-format",
        "stream-json",
        "--approval-mode",
        request.mode === "read-only" ? "plan" : "auto_edit",
      ],
    };
  }
}
