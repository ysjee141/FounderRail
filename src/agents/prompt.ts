import type { AgentDefinition } from "./types.js";

export function compileAgentPrompt(agent: AgentDefinition, request: string): string {
  return [
    `# Role: ${agent.name} (${agent.id})`,
    "",
    agent.instructions.trim(),
    "",
    "## Enforced operating boundary",
    `Readable paths:\n${agent.context.read.map((item) => `- ${item}`).join("\n")}`,
    `Writable paths:\n${agent.context.write.map((item) => `- ${item}`).join("\n")}`,
    `Denied actions:\n${agent.tools.deny.map((item) => `- ${item}`).join("\n")}`,
    `Actions requiring human approval:\n${agent.approval.required_for.map((item) => `- ${item}`).join("\n")}`,
    "Do not read or modify paths outside these scopes. Do not perform denied or approval-gated actions.",
    "",
    "## Output contract",
    "Return one JSON object matching this schema. Do not wrap it in Markdown fences.",
    JSON.stringify(agent.outputSchema, null, 2),
    "",
    "## Request",
    request,
  ].join("\n");
}
