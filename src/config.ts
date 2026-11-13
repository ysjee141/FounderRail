import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { RUNTIME_NAMES, type RuntimeName } from "./runtime/types.js";

export interface TeamConfig {
  version: 1;
  runtime: RuntimeName;
  createdAt: string;
  updatedAt?: string;
}

export function isRuntimeName(value: string): value is RuntimeName {
  return RUNTIME_NAMES.includes(value as RuntimeName);
}

export function stateDirectory(root: string): string {
  return path.join(root, ".agent-team");
}

export async function initializeConfig(root: string, runtime: RuntimeName): Promise<TeamConfig> {
  const stateDir = stateDirectory(root);
  await mkdir(path.join(stateDir, "events"), { recursive: true });
  const config: TeamConfig = { version: 1, runtime, createdAt: new Date().toISOString() };
  await writeFile(path.join(stateDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { flag: "wx" });
  return config;
}

export async function loadConfig(root: string): Promise<TeamConfig> {
  const raw = await readFile(path.join(stateDirectory(root), "config.json"), "utf8");
  const value = JSON.parse(raw) as Partial<TeamConfig>;
  if (value.version !== 1 || typeof value.runtime !== "string" || !isRuntimeName(value.runtime)) {
    throw new Error("Invalid .agent-team/config.json");
  }
  return value as TeamConfig;
}

export async function setSelectedRuntime(root: string, runtime: RuntimeName): Promise<TeamConfig> {
  const current = await loadConfig(root);
  const updated: TeamConfig = { ...current, runtime, updatedAt: new Date().toISOString() };
  const target = path.join(stateDirectory(root), "config.json");
  const temporary = path.join(stateDirectory(root), `config.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, target);
  return updated;
}
