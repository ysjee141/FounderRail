import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { AGENT_IDS, type AgentId } from "../agents/types.js";
import { normalizeScopedPath } from "../agents/path-policy.js";
import { resolveExistingProjectFile } from "../security/project-path.js";

const sourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  authority: z.string().min(1),
  url: z.url(),
  kind: z.enum(["official", "standard", "vendor", "research", "secondary"]),
  module: z.string().regex(/^[a-z0-9-/]+$/),
  jurisdiction: z.string().min(1),
  content_path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  retrieved_at: z.iso.date(),
  verified_at: z.iso.date().nullable(),
  review_after: z.iso.date(),
  status: z.enum(["candidate", "verified", "rejected"]),
}).strict();

const sourceManifestSchema = z.object({ version: z.literal(1), sources: z.array(sourceSchema) }).strict();

const cardSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  module: z.string().regex(/^[a-z0-9-/]+$/),
  claim: z.string().min(1),
  action: z.string().min(1),
  applies_when: z.string().min(1),
  does_not_apply_when: z.string().min(1),
  source_ids: z.array(z.string().regex(/^[a-z0-9-]+$/)).min(1),
  roles: z.array(z.enum(AGENT_IDS)).min(1),
  verified_at: z.iso.date(),
  review_after: z.iso.date(),
  risk: z.enum(["low", "medium", "high"]),
  professional_review: z.enum(["never", "conditional", "required"]),
  status: z.enum(["draft", "verified", "rejected"]),
}).strict();

const catalogSchema = z.object({
  version: z.literal(1),
  active_modules: z.array(z.string().regex(/^[a-z0-9-/]+$/)),
}).passthrough();

export type KnowledgeSource = z.infer<typeof sourceSchema>;
export type KnowledgeCard = z.infer<typeof cardSchema>;

export interface KnowledgeIssue {
  code: string;
  subject: string;
  message: string;
}

export interface KnowledgeAudit {
  qualified: boolean;
  checkedAt: string;
  activeModules: string[];
  validSources: KnowledgeSource[];
  validCards: KnowledgeCard[];
  coverageGaps: string[];
  issues: KnowledgeIssue[];
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function issue(code: string, subject: string, message: string): KnowledgeIssue {
  return { code, subject, message };
}

async function loadCards(root: string, issues: KnowledgeIssue[]): Promise<KnowledgeCard[]> {
  const directory = path.join(root, "knowledge", "cards");
  const entries = await readdir(directory, { withFileTypes: true });
  const cards: KnowledgeCard[] = [];
  for (const entry of entries.filter((item) => item.isFile() && /\.ya?ml$/.test(item.name)).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      cards.push(cardSchema.parse(parse(await readFile(path.join(directory, entry.name), "utf8"))));
    } catch (error) {
      issues.push(issue("invalid_card", entry.name, error instanceof Error ? error.message : String(error)));
    }
  }
  return cards;
}

async function verifySourceFile(root: string, source: KnowledgeSource): Promise<string | undefined> {
  const normalized = normalizeScopedPath(source.content_path);
  if (!normalized || !normalized.startsWith("knowledge/sources/snapshots/")) {
    throw new Error("content_path must be below knowledge/sources/snapshots/");
  }
  const snapshotsRoot = await realpath(path.join(root, "knowledge", "sources", "snapshots"));
  const absolute = await resolveExistingProjectFile(root, normalized);
  const relativeToSnapshots = path.relative(snapshotsRoot, absolute);
  if (!relativeToSnapshots || relativeToSnapshots.startsWith("..") || path.isAbsolute(relativeToSnapshots)) {
    throw new Error("source snapshot resolves outside knowledge/sources/snapshots/");
  }
  const info = await lstat(absolute);
  if (!info.isFile()) throw new Error("source snapshot is not a regular file");
  const content = await readFile(absolute);
  if (sha256(content) !== source.sha256) throw new Error("source snapshot hash does not match manifest");
  return content.toString("utf8");
}

export async function auditKnowledge(root: string, now = new Date()): Promise<KnowledgeAudit> {
  const issues: KnowledgeIssue[] = [];
  const manifest = sourceManifestSchema.parse(parse(await readFile(path.join(root, "knowledge", "sources", "manifest.yaml"), "utf8")));
  const catalog = catalogSchema.parse(parse(await readFile(path.join(root, "knowledge", "catalog.yaml"), "utf8")));
  const date = today(now);
  const validSources: KnowledgeSource[] = [];
  const sourceCounts = new Map<string, number>();
  for (const source of manifest.sources) sourceCounts.set(source.id, (sourceCounts.get(source.id) ?? 0) + 1);

  for (const source of manifest.sources) {
    if ((sourceCounts.get(source.id) ?? 0) > 1) {
      if (!issues.some((item) => item.code === "duplicate_source" && item.subject === source.id)) {
        issues.push(issue("duplicate_source", source.id, "source id is duplicated"));
      }
      continue;
    }
    if (source.status !== "verified" || source.verified_at === null) {
      issues.push(issue("unverified_source", source.id, "source is not verified"));
      continue;
    }
    if (source.review_after < date) {
      issues.push(issue("stale_source", source.id, `source review was due ${source.review_after}`));
      continue;
    }
    try {
      await verifySourceFile(root, source);
      validSources.push(source);
    } catch (error) {
      issues.push(issue("invalid_source_snapshot", source.id, error instanceof Error ? error.message : String(error)));
    }
  }

  const validSourceIds = new Set(validSources.map((source) => source.id));
  const cards = await loadCards(root, issues);
  const validCards: KnowledgeCard[] = [];
  const cardCounts = new Map<string, number>();
  for (const card of cards) cardCounts.set(card.id, (cardCounts.get(card.id) ?? 0) + 1);
  for (const card of cards) {
    if ((cardCounts.get(card.id) ?? 0) > 1) {
      if (!issues.some((item) => item.code === "duplicate_card" && item.subject === card.id)) {
        issues.push(issue("duplicate_card", card.id, "card id is duplicated"));
      }
      continue;
    }
    if (card.status !== "verified") {
      issues.push(issue("unverified_card", card.id, "card is not verified"));
      continue;
    }
    if (card.review_after < date) {
      issues.push(issue("stale_card", card.id, `card review was due ${card.review_after}`));
      continue;
    }
    const invalidReferences = card.source_ids.filter((id) => !validSourceIds.has(id));
    if (invalidReferences.length > 0) {
      issues.push(issue("invalid_card_sources", card.id, `invalid sources: ${invalidReferences.join(", ")}`));
      continue;
    }
    validCards.push(card);
  }

  const coveredModules = new Set(validCards.map((card) => card.module));
  const coverageGaps = catalog.active_modules.filter((module) => !coveredModules.has(module));
  for (const module of coverageGaps) issues.push(issue("module_coverage_gap", module, "active module has no fresh verified card"));
  return {
    qualified: issues.length === 0,
    checkedAt: now.toISOString(),
    activeModules: catalog.active_modules,
    validSources,
    validCards,
    coverageGaps,
    issues,
  };
}

function renderCard(card: KnowledgeCard, sources: Map<string, KnowledgeSource>): string {
  const citations = card.source_ids.map((id) => {
    const source = sources.get(id);
    if (!source) throw new Error(`Missing source while rendering card ${card.id}: ${id}`);
    return `- [${source.title}](${source.url}) — ${source.authority}, verified ${source.verified_at}`;
  });
  return [
    `# ${card.title}`,
    "",
    `- Card: \`${card.id}\``,
    `- Module: \`${card.module}\``,
    `- Risk: \`${card.risk}\``,
    `- Review after: \`${card.review_after}\``,
    `- Professional review: \`${card.professional_review}\``,
    "",
    "## Claim",
    "",
    card.claim,
    "",
    "## Action",
    "",
    card.action,
    "",
    "## Applies when",
    "",
    card.applies_when,
    "",
    "## Does not apply when",
    "",
    card.does_not_apply_when,
    "",
    "## Sources",
    "",
    ...citations,
    "",
  ].join("\n");
}

async function ensureCompiledDirectory(root: string): Promise<string> {
  const rootReal = await realpath(root);
  const knowledge = path.join(rootReal, "knowledge");
  const knowledgeInfo = await lstat(knowledge);
  if (knowledgeInfo.isSymbolicLink() || !knowledgeInfo.isDirectory()) throw new Error("knowledge must be a real directory");
  const target = path.join(knowledge, "compiled");
  try {
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("knowledge/compiled must be a real directory");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(target);
  }
  return target;
}

export async function compileKnowledge(root: string, now = new Date()): Promise<{
  audit: KnowledgeAudit;
  written: string[];
}> {
  const audit = await auditKnowledge(root, now);
  const directory = await ensureCompiledDirectory(root);
  const sources = new Map(audit.validSources.map((source) => [source.id, source]));
  const written: string[] = [];
  for (const card of audit.validCards) {
    const relative = `knowledge/compiled/${card.id}.md`;
    const target = path.join(directory, `${card.id}.md`);
    const temporary = path.join(directory, `.${card.id}.${randomUUID()}.tmp`);
    await writeFile(temporary, renderCard(card, sources), { flag: "wx" });
    await rename(temporary, target);
    written.push(relative);
  }
  return { audit, written };
}

export async function loadApprovedKnowledgeContext(root: string, agentId: AgentId, now = new Date()): Promise<Array<{
  path: string;
  content: string;
  sha256: string;
}>> {
  const audit = await auditKnowledge(root, now);
  const sources = new Map(audit.validSources.map((source) => [source.id, source]));
  return audit.validCards.filter((card) => card.roles.includes(agentId)).map((card) => {
    const content = renderCard(card, sources);
    return { path: `knowledge/compiled/${card.id}.md`, content, sha256: sha256(content) };
  });
}
