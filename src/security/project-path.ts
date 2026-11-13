import { realpath } from "node:fs/promises";
import path from "node:path";

export async function resolveExistingProjectFile(root: string, candidate: string): Promise<string> {
  const rootReal = await realpath(root);
  const candidateReal = await realpath(path.resolve(root, candidate));
  const relative = path.relative(rootReal, candidateReal);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("File must be a regular project file below the project root");
  }
  return candidateReal;
}
