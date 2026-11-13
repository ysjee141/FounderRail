import { BaseRuntimeAdapter } from "../base-adapter.js";
import type { RuntimeInvocation, RuntimeRunRequest } from "../types.js";

export class CodexRuntimeAdapter extends BaseRuntimeAdapter {
  readonly name = "codex" as const;
  readonly command = "codex";

  buildInvocation(request: RuntimeRunRequest): RuntimeInvocation {
    const structuredOutputArgs = request.outputSchema
      ? ["--output-schema", request.outputSchema.path]
      : [];
    return {
      command: this.command,
      args: [
        "--ask-for-approval",
        "never",
        "exec",
        "--ignore-user-config",
        "--ephemeral",
        "--json",
        "--sandbox",
        request.mode,
        ...structuredOutputArgs,
        "-",
      ],
      stdin: request.prompt,
    };
  }
}
