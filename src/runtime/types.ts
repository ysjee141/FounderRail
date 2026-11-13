export const RUNTIME_NAMES = ["claude", "codex", "gemini"] as const;

export type RuntimeName = (typeof RUNTIME_NAMES)[number];
export type RuntimeMode = "read-only" | "workspace-write";

export interface RuntimeProbe {
  name: RuntimeName;
  command: string;
  available: boolean;
  version?: string;
  error?: string;
}

export interface RuntimeInvocation {
  command: string;
  args: string[];
  stdin?: string;
}

export interface RuntimeRunRequest {
  prompt: string;
  cwd: string;
  mode: RuntimeMode;
  timeoutMs: number;
  signal?: AbortSignal;
  outputSchema?: {
    schema: Record<string, unknown>;
    path: string;
  };
}

export interface RuntimeEvent {
  runId: string;
  sequence: number;
  timestamp: string;
  runtime: RuntimeName;
  type: "run.started" | "runtime.stdout" | "runtime.stderr" | "run.completed" | "run.failed";
  payload: Record<string, unknown>;
}

export interface RuntimeResult {
  runId: string;
  runtime: RuntimeName;
  exitCode: number;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
  termination: "completed" | "timed_out" | "aborted" | "failed";
  signal?: NodeJS.Signals;
}

export interface RuntimeAdapter {
  readonly name: RuntimeName;
  readonly command: string;
  probe(): Promise<RuntimeProbe>;
  buildInvocation(request: RuntimeRunRequest): RuntimeInvocation;
  run(request: RuntimeRunRequest, onEvent?: (event: RuntimeEvent) => Promise<void>): Promise<RuntimeResult>;
}
