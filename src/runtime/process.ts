import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
  RuntimeEvent,
  RuntimeInvocation,
  RuntimeName,
  RuntimeResult,
  RuntimeRunRequest,
} from "./types.js";

export async function probeCommand(name: RuntimeName, command: string): Promise<{
  available: boolean;
  version?: string;
  error?: string;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve({ available: false, error: error.code === "ENOENT" ? `${command} not found` : error.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ available: true, version: stdout.trim() || stderr.trim() || "unknown" });
      } else {
        resolve({ available: false, error: (stderr || stdout).trim() || `${name} exited with ${code}` });
      }
    });
  });
}

function parseJsonLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return line;
  }
}

function killProcessTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
    }
  }
  child.kill(signal);
}

export async function runInvocation(
  runtime: RuntimeName,
  invocation: RuntimeInvocation,
  request: RuntimeRunRequest,
  onEvent?: (event: RuntimeEvent) => Promise<void>,
): Promise<RuntimeResult> {
  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  let sequence = 0;
  let eventChain = Promise.resolve();

  const emit = async (type: RuntimeEvent["type"], payload: Record<string, unknown>): Promise<void> => {
    await onEvent?.({
      runId,
      sequence: sequence++,
      timestamp: new Date().toISOString(),
      runtime,
      type,
      payload,
    });
  };

  const enqueue = (type: RuntimeEvent["type"], payload: Record<string, unknown>): void => {
    eventChain = eventChain.then(() => emit(type, payload));
  };

  await emit("run.started", {
    command: invocation.command,
    args: invocation.args,
    cwd: request.cwd,
    mode: request.mode,
  });

  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: request.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;
    let stopReason: "timed_out" | "aborted" | undefined;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const consume = (stream: "stdout" | "stderr", chunk: string): void => {
      if (stream === "stdout") {
        stdout += chunk;
        stdoutBuffer += chunk;
      } else {
        stderr += chunk;
        stderrBuffer += chunk;
      }

      const current = stream === "stdout" ? stdoutBuffer : stderrBuffer;
      const lines = current.split(/\r?\n/);
      const remainder = lines.pop() ?? "";
      if (stream === "stdout") stdoutBuffer = remainder;
      else stderrBuffer = remainder;

      for (const line of lines) {
        if (line.length > 0) enqueue(stream === "stdout" ? "runtime.stdout" : "runtime.stderr", { data: parseJsonLine(line) });
      }
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => consume("stdout", chunk));
    child.stderr.on("data", (chunk: string) => consume("stderr", chunk));

    const stop = (reason: "timed_out" | "aborted"): void => {
      if (settled || stopReason) return;
      stopReason = reason;
      killProcessTree(child, "SIGTERM");
      forceKillTimer = setTimeout(() => killProcessTree(child, "SIGKILL"), 2_000);
      forceKillTimer.unref();
    };
    const timer = setTimeout(() => stop("timed_out"), request.timeoutMs);
    timer.unref();
    const abort = (): void => stop("aborted");
    request.signal?.addEventListener("abort", abort, { once: true });
    if (request.signal?.aborted) abort();

    const cleanup = (): void => {
      clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      request.signal?.removeEventListener("abort", abort);
    };

    child.on("error", async (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      await eventChain;
      await emit("run.failed", { error: error.message });
      reject(error);
    });

    child.on("close", async (exitCode, signal) => {
      if (settled) return;
      settled = true;
      if (stopReason) killProcessTree(child, "SIGKILL");
      cleanup();
      await eventChain;
      if (stdoutBuffer) await emit("runtime.stdout", { data: parseJsonLine(stdoutBuffer) });
      if (stderrBuffer) await emit("runtime.stderr", { data: parseJsonLine(stderrBuffer) });

      const code = stopReason === "timed_out" ? 124 : stopReason === "aborted" ? 130 : exitCode ?? (signal ? 128 : 1);
      const termination = stopReason ?? (code === 0 ? "completed" : "failed");
      await emit(code === 0 ? "run.completed" : "run.failed", { exitCode: code, signal, termination });
      resolve({
        runId,
        runtime,
        exitCode: code,
        stdout,
        stderr,
        startedAt,
        finishedAt: new Date().toISOString(),
        termination,
        ...(signal ? { signal } : {}),
      });
    });

    if (invocation.stdin !== undefined) child.stdin.end(invocation.stdin);
    else child.stdin.end();
  });
}
