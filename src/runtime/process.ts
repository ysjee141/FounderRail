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
    });
    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let settled = false;

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

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, request.timeoutMs);
    timer.unref();

    child.on("error", async (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await eventChain;
      await emit("run.failed", { error: error.message });
      reject(error);
    });

    child.on("close", async (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      await eventChain;
      if (stdoutBuffer) await emit("runtime.stdout", { data: parseJsonLine(stdoutBuffer) });
      if (stderrBuffer) await emit("runtime.stderr", { data: parseJsonLine(stderrBuffer) });

      const code = exitCode ?? (signal ? 128 : 1);
      await emit(code === 0 ? "run.completed" : "run.failed", { exitCode: code, signal });
      resolve({
        runId,
        runtime,
        exitCode: code,
        stdout,
        stderr,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    });

    if (invocation.stdin !== undefined) child.stdin.end(invocation.stdin);
    else child.stdin.end();
  });
}
