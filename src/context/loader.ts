import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { canReadPath } from "../agents/path-policy.js";
import type { AgentDefinition } from "../agents/types.js";
import { loadApprovedKnowledgeContext } from "../knowledge/cards.js";

export interface ContextDocument {
  path: string;
  content: string;
  sha256: string;
}

const TEXT_EXTENSIONS = new Set([".md", ".yaml", ".yml", ".json", ".csv", ".txt"]);

async function walkFiles(root: string, relative: string): Promise<string[]> {
  const absolute = path.join(root, relative);
  try {
    const info = await lstat(absolute);
    if (info.isSymbolicLink() || !info.isDirectory()) return [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  let entries;
  try {
    entries = await readdir(absolute, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const candidate = path.posix.join(relative, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) files.push(...await walkFiles(root, candidate));
    else if (entry.isFile()) files.push(candidate);
  }
  return files;
}

export async function loadAgentContext(
  root: string,
  agent: AgentDefinition,
  limits = { perFileBytes: 100_000, totalBytes: 500_000 },
): Promise<ContextDocument[]> {
  const candidates = [
    ...await walkFiles(root, "company"),
    ...await walkFiles(root, "work"),
  ].filter((candidate) => canReadPath(agent.context.read, candidate));

  const documents: ContextDocument[] = [];
  let totalBytes = 0;
  for (const candidate of candidates.sort()) {
    if (!TEXT_EXTENSIONS.has(path.extname(candidate).toLowerCase())) continue;
    const absolute = path.join(root, ...candidate.split("/"));
    const info = await lstat(absolute);
    if (!info.isFile() || info.size > limits.perFileBytes || totalBytes + info.size > limits.totalBytes) continue;
    const buffer = await readFile(absolute);
    if (buffer.includes(0)) continue;
    totalBytes += buffer.byteLength;
    documents.push({
      path: candidate,
      content: buffer.toString("utf8"),
      sha256: createHash("sha256").update(buffer).digest("hex"),
    });
  }
  let knowledge: ContextDocument[] = [];
  try {
    knowledge = await loadApprovedKnowledgeContext(root, agent.id);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  for (const document of knowledge) {
    const bytes = Buffer.byteLength(document.content);
    if (bytes > limits.perFileBytes || totalBytes + bytes > limits.totalBytes) continue;
    totalBytes += bytes;
    documents.push(document);
  }
  return documents;
}
