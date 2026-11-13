import { ZodError } from "zod";
import { agentResultSchema, type AgentResult } from "../tasks/contracts.js";
import type { RuntimeName, RuntimeResult } from "./types.js";

type JsonObject = Record<string, unknown>;

export class RuntimeContractError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RuntimeContractError";
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonLines(runtime: RuntimeName, stdout: string): JsonObject[] {
  const events: JsonObject[] = [];
  for (const [index, line] of stdout.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new RuntimeContractError(`${runtime} emitted invalid JSONL at line ${index + 1}`, { cause: error });
    }
    if (!isObject(value)) {
      throw new RuntimeContractError(`${runtime} emitted a non-object JSONL event at line ${index + 1}`);
    }
    events.push(value);
  }
  if (events.length === 0) throw new RuntimeContractError(`${runtime} emitted no JSONL events`);
  return events;
}

function claudeFinalValue(events: JsonObject[]): unknown {
  const result = events.findLast((event) => event.type === "result");
  if (!result) throw new RuntimeContractError("claude stream has no result event");
  if (result.subtype !== "success" || result.is_error === true) {
    throw new RuntimeContractError(`claude result was not successful (${String(result.subtype ?? "unknown")})`);
  }
  if (isObject(result.structured_output)) return result.structured_output;
  if (typeof result.result === "string" && result.result.trim()) return result.result;
  throw new RuntimeContractError("claude result has no structured_output or result text");
}

function codexFinalValue(events: JsonObject[]): unknown {
  const completed = events.findLast((event) => {
    if (event.type !== "item.completed" || !isObject(event.item)) return false;
    return event.item.type === "agent_message" && typeof event.item.text === "string";
  });
  if (!completed || !isObject(completed.item) || typeof completed.item.text !== "string") {
    throw new RuntimeContractError("codex stream has no completed agent message");
  }
  return completed.item.text;
}

function geminiFinalValue(events: JsonObject[]): unknown {
  const terminal = events.findLast((event) => event.type === "result");
  if (!terminal || terminal.status !== "success") {
    throw new RuntimeContractError(`gemini stream was not successful (${String(terminal?.status ?? "missing result")})`);
  }
  const chunks = events.flatMap((event) => {
    if (event.type !== "message" || event.role !== "assistant" || typeof event.content !== "string") return [];
    return [event.content];
  });
  if (chunks.length === 0) throw new RuntimeContractError("gemini stream has no assistant message");
  return chunks.join("");
}

export function extractRuntimeFinalValue(runtime: RuntimeName, stdout: string): unknown {
  const events = parseJsonLines(runtime, stdout);
  if (runtime === "claude") return claudeFinalValue(events);
  if (runtime === "codex") return codexFinalValue(events);
  return geminiFinalValue(events);
}

function parseJsonObject(runtime: RuntimeName, value: unknown): unknown {
  if (isObject(value)) return value;
  if (typeof value !== "string") throw new RuntimeContractError(`${runtime} final response is not a JSON object`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new RuntimeContractError(`${runtime} final response is not valid JSON`, { cause: error });
  }
  if (!isObject(parsed)) throw new RuntimeContractError(`${runtime} final response is not a JSON object`);
  return parsed;
}

export function parseAgentRuntimeResult(result: RuntimeResult): AgentResult {
  if (result.exitCode !== 0) {
    throw new RuntimeContractError(`${result.runtime} exited with code ${result.exitCode}`);
  }
  const value = parseJsonObject(result.runtime, extractRuntimeFinalValue(result.runtime, result.stdout));
  try {
    return agentResultSchema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      const fields = [...new Set(error.issues.map((issue) => issue.path.join(".") || "root"))].join(", ");
      throw new RuntimeContractError(`${result.runtime} final response violates Agent Result contract: ${fields}`, {
        cause: error,
      });
    }
    throw error;
  }
}
