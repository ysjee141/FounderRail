import path from "node:path";

function normalizedRelativePath(candidate: string): string | undefined {
  if (path.isAbsolute(candidate)) return undefined;
  const portable = candidate.replaceAll("\\", "/");
  if (portable.split("/").includes("..")) return undefined;
  const normalized = path.posix.normalize(portable);
  if (normalized === ".." || normalized.startsWith("../")) return undefined;
  return normalized.replace(/^\.\//, "");
}

export function matchesScope(candidate: string, scope: string): boolean {
  const normalized = normalizedRelativePath(candidate);
  if (!normalized) return false;
  if (scope.endsWith("/**")) {
    const prefix = scope.slice(0, -3).replace(/\/$/, "");
    return normalized === prefix || normalized.startsWith(`${prefix}/`);
  }
  return normalized === scope;
}

export function canReadPath(scopes: string[], candidate: string): boolean {
  return scopes.some((scope) => matchesScope(candidate, scope));
}

export function canWritePath(scopes: string[], candidate: string): boolean {
  return scopes.some((scope) => matchesScope(candidate, scope));
}
