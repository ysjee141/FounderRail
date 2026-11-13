import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
}

const bundledTemplates = fileURLToPath(new URL("../../templates", import.meta.url));

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
  let current = rootReal;
  for (const segment of relative.split("/").slice(0, -1)) {
    const candidate = path.join(current, segment);
    const info = await optionalLstat(candidate);
    if (info?.isSymbolicLink()) throw new Error(`Refusing to scaffold through symlink: ${relative}`);
    if (info && !info.isDirectory()) throw new Error(`Scaffold parent is not a directory: ${relative}`);
    if (!info) await mkdir(candidate);
    current = candidate;
  }
  return current;
}

async function listTemplateFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(directory, prefix), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await listTemplateFiles(directory, relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

export async function scaffoldProject(root: string, templateRoot = bundledTemplates): Promise<ScaffoldResult> {
  const files = await listTemplateFiles(templateRoot);
  const result: ScaffoldResult = { created: [], skipped: [] };

  for (const relative of files) {
    const parent = await ensureSafeParent(root, relative);
    const target = path.join(parent, path.posix.basename(relative));
    try {
      await copyFile(path.join(templateRoot, ...relative.split("/")), target, constants.COPYFILE_EXCL);
      result.created.push(relative);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      result.skipped.push(relative);
    }
  }
  return result;
}
