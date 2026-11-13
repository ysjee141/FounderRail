import { BaseRuntimeAdapter } from "../base-adapter.js";
import type { RuntimeInvocation, RuntimeRunRequest } from "../types.js";

export class CodexRuntimeAdapter extends BaseRuntimeAdapter {
  readonly name = "codex" as const;
  readonly command = "codex";

  buildInvocation(request: RuntimeRunRequest): RuntimeInvocation {
    return {
      command: this.command,
      args: [
        "exec",
        "--json",
        "--sandbox",
        request.mode,
        "--ask-for-approval",
        "never",
        "-",
      ],
      stdin: request.prompt,
    };
  }
}
