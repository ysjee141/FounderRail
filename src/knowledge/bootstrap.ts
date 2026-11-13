import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";

const undecidedBoolean = z.union([z.boolean(), z.literal("undecided")]);
const profileSchema = z.object({
  version: z.literal(1),
  business: z.object({
    home_jurisdiction: z.string().min(1),
    entity_status: z.string().min(1),
    target_markets: z.array(z.string().min(1)).min(1),
    customer_type: z.string().min(1),
    revenue_model: z.array(z.string().min(1)).min(1),
  }),
  product: z.object({
    form: z.string().min(1),
    distribution: z.array(z.string().min(1)).min(1),
    stage: z.string().min(1),
    has_ai_features: undecidedBoolean,
    allows_user_content: undecidedBoolean,
  }),
  data: z.object({
    categories: z.array(z.string()).min(1),
    sensitive_categories: z.array(z.string()),
    minors_possible: undecidedBoolean,
    storage_regions: z.array(z.string()).min(1),
  }),
  technology: z.object({
    cloud: z.string().min(1),
    auth: z.string().min(1),
    payment_provider: z.string().min(1),
    analytics: z.string().min(1),
  }),
  operations: z.object({
    availability_target: z.string().min(1),
    recovery_target: z.string().min(1),
    support_channel: z.string().min(1),
  }),
});

export type BusinessProductProfile = z.infer<typeof profileSchema>;

const BASELINE_MODULES = [
  "business-foundation",
  "product-discovery",
  "engineering-baseline",
  "secure-development",
  "privacy-data",
  "accessibility",
  "finance-admin",
  "release-support",
];

function collectUndecided(value: unknown, prefix = ""): string[] {
  if (value === "undecided") return [prefix];
  if (Array.isArray(value)) return value.flatMap((item, index) => collectUndecided(item, `${prefix}[${index}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => collectUndecided(item, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

export function selectKnowledgeModules(profile: BusinessProductProfile) {
  const conditional = new Set<string>();
  if (profile.product.form === "web_saas") conditional.add("saas");
  if (["desktop", "local_app"].includes(profile.product.form)) conditional.add("desktop-distribution");
  if (profile.product.form === "mobile" || profile.product.distribution.some((item) => ["apple_app_store", "google_play"].includes(item))) conditional.add("mobile-store");
  if (profile.product.form === "api") conditional.add("api-product");
  if (profile.business.revenue_model.includes("subscription")) conditional.add("subscription-commerce");
  if (profile.product.has_ai_features === true) conditional.add("ai-feature-safety");
  if (profile.product.allows_user_content === true) conditional.add("trust-safety");
  if (profile.data.minors_possible === true || profile.data.sensitive_categories.length > 0) conditional.add("high-risk-data");

  const overlays = new Set<string>();
  if (profile.business.home_jurisdiction !== "undecided") overlays.add(`jurisdiction/${profile.business.home_jurisdiction.toLowerCase()}`);
  for (const market of profile.business.target_markets) {
    if (market !== "undecided") overlays.add(`market/${market.toLowerCase()}`);
  }
  for (const channel of profile.product.distribution) {
    if (channel !== "undecided") overlays.add(`channel/${channel.replaceAll("_", "-")}`);
  }

  const undecided = collectUndecided(profile);
  return {
    ready: undecided.length === 0,
    baselineModules: BASELINE_MODULES,
    conditionalModules: [...conditional].sort(),
    overlays: [...overlays].sort(),
    undecided,
  };
}

export async function readBootstrapStatus(root: string) {
  const raw = await readFile(path.join(root, "company", "profile.yaml"), "utf8");
  const profile = profileSchema.parse(parse(raw));
  return { profile, selection: selectKnowledgeModules(profile) };
}
