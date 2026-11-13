import type { AgentDefinition } from "./types.js";
import type { ContextDocument } from "../context/loader.js";

export interface PromptBoundary {
  writablePaths?: string[];
  forbiddenActions?: string[];
}

export function compileAgentPrompt(
  agent: AgentDefinition,
  request: string,
  context: ContextDocument[] = [],
  boundary: PromptBoundary = {},
): string {
  const writablePaths = boundary.writablePaths ?? agent.context.write;
  const forbiddenActions = [...new Set([...agent.tools.deny, ...(boundary.forbiddenActions ?? [])])];
  const sections = [
    `# Role: ${agent.name} (${agent.id})`,
    "",
    agent.instructions.trim(),
    "",
    "## Enforced operating boundary",
    `Readable paths:\n${agent.context.read.map((item) => `- ${item}`).join("\n")}`,
    `Writable paths:\n${writablePaths.map((item) => `- ${item}`).join("\n") || "- none"}`,
    `Denied actions:\n${forbiddenActions.map((item) => `- ${item}`).join("\n")}`,
    `Actions requiring human approval:\n${agent.approval.required_for.map((item) => `- ${item}`).join("\n")}`,
    "Do not read or modify paths outside these scopes. Do not perform denied or approval-gated actions.",
    "",
  ];
  if (context.length > 0) {
    sections.push(
      "## Approved company context",
      ...context.flatMap((document) => [
        `### ${document.path} (sha256:${document.sha256})`,
        document.content.trim(),
        "",
      ]),
    );
  }
  sections.push(
    "## Output contract",
    "Return one JSON object matching this schema. Do not wrap it in Markdown fences.",
    JSON.stringify(agent.outputSchema, null, 2),
    "",
    "## Request",
    request,
  );
  return sections.join("\n");
}
