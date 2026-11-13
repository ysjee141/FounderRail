import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { canWritePath, normalizeScopedPath } from "../agents/path-policy.js";
import type { AgentDefinition } from "../agents/types.js";

export interface WriteEvidence {
  path: string;
  previousSha256: string | null;
  sha256: string;
}

export class DocumentOwnershipError extends Error {}

async function optionalLstat(candidate: string) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function ensureSafeParent(root: string, relative: string): Promise<string> {
  const rootReal = await realpath(root);
  const segments = relative.split("/").slice(0, -1);
  let current = rootReal;
  for (const segment of segments) {
    const candidate = path.join(current, segment);
    const info = await optionalLstat(candidate);
    if (info?.isSymbolicLink()) throw new DocumentOwnershipError(`Symlink directory is not writable: ${relative}`);
    if (info && !info.isDirectory()) throw new DocumentOwnershipError(`Parent is not a directory: ${relative}`);
    if (!info) await mkdir(candidate);
    current = candidate;
  }
  return current;
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function writeScopedArtifact(
  root: string,
  agent: AgentDefinition,
  relativePath: string,
  content: string,
): Promise<WriteEvidence> {
  if (!canWritePath(agent.context.write, relativePath)) {
    throw new DocumentOwnershipError(`${agent.id} cannot write ${relativePath}`);
  }
  const normalizedPath = normalizeScopedPath(relativePath);
  if (!normalizedPath) throw new DocumentOwnershipError(`Invalid artifact path: ${relativePath}`);

  const parent = await ensureSafeParent(root, normalizedPath);
  const target = path.join(parent, path.posix.basename(normalizedPath));
  const targetInfo = await optionalLstat(target);
  if (targetInfo?.isSymbolicLink() || (targetInfo && !targetInfo.isFile())) {
    throw new DocumentOwnershipError(`Target is not a regular file: ${normalizedPath}`);
  }
  const previous = targetInfo ? await readFile(target) : undefined;
  const temporary = path.join(parent, `.agent-team-${randomUUID()}.tmp`);
  await writeFile(temporary, content, { flag: "wx" });
  try {
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
  return {
    path: normalizedPath,
    previousSha256: previous ? sha256(previous) : null,
    sha256: sha256(content),
  };
}
