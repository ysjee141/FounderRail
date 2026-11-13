export const RISK_FLAGS = [
  "authentication",
  "authorization",
  "payment",
  "personal-data",
  "file-upload",
  "infrastructure",
  "migration",
  "backup-recovery",
] as const;

export type RiskFlag = (typeof RISK_FLAGS)[number];

const RULES: Array<{ flag: RiskFlag; pattern: RegExp }> = [
  { flag: "authentication", pattern: /(^|[\/_-])(auth|login|session|oauth|sso|password|credential)([\/_\-.]|$)/i },
  { flag: "authorization", pattern: /(^|[\/_-])(permission|role|policy|access-control|acl)([\/_\-.]|$)/i },
  { flag: "payment", pattern: /(^|[\/_-])(payment|billing|subscription|invoice|refund|checkout)([\/_\-.]|$)/i },
  { flag: "personal-data", pattern: /(^|[\/_-])(privacy|personal-data|profile|tracking|analytics|retention|deletion)([\/_\-.]|$)/i },
  { flag: "file-upload", pattern: /(^|[\/_-])(upload|attachment|object-storage)([\/_\-.]|$)/i },
  { flag: "infrastructure", pattern: /(^|[\/_-])(infra|terraform|kubernetes|docker|deploy|network|iam)([\/_\-.]|$)/i },
  { flag: "migration", pattern: /(^|[\/_-])(migration|schema|backfill)([\/_\-.]|$)/i },
  { flag: "backup-recovery", pattern: /(^|[\/_-])(backup|restore|recovery|rollback)([\/_\-.]|$)/i },
];

export function deriveRiskFlags(pathsAndLabels: string[]): RiskFlag[] {
  const flags = new Set<RiskFlag>();
  for (const value of pathsAndLabels) {
    for (const rule of RULES) if (rule.pattern.test(value)) flags.add(rule.flag);
  }
  return RISK_FLAGS.filter((flag) => flags.has(flag));
}
