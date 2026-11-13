export const AGENT_IDS = [
  "founder-office",
  "product-growth",
  "engineering",
  "finance-ops",
  "risk-quality",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export interface AgentDefinition {
  id: AgentId;
  name: string;
  description: string;
  triggers: string[];
  context: {
    read: string[];
    write: string[];
  };
  tools: {
    allow: string[];
    deny: string[];
  };
  outputs: {
    schema: string;
  };
  approval: {
    required_for: string[];
  };
  instructions: string;
  outputSchema: Record<string, unknown>;
}
