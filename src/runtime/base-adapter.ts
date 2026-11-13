import { probeCommand, runInvocation } from "./process.js";
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimeInvocation,
  RuntimeName,
  RuntimeProbe,
  RuntimeResult,
  RuntimeRunRequest,
} from "./types.js";

export abstract class BaseRuntimeAdapter implements RuntimeAdapter {
  abstract readonly name: RuntimeName;
  abstract readonly command: string;
  abstract buildInvocation(request: RuntimeRunRequest): RuntimeInvocation;

  async probe(): Promise<RuntimeProbe> {
    const result = await probeCommand(this.name, this.command);
    return { name: this.name, command: this.command, ...result };
  }

  async run(
    request: RuntimeRunRequest,
    onEvent?: (event: RuntimeEvent) => Promise<void>,
  ): Promise<RuntimeResult> {
    return runInvocation(this.name, this.buildInvocation(request), request, onEvent);
  }
}
