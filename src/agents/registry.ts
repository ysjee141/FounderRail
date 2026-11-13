import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { AGENT_IDS, type AgentDefinition, type AgentId } from "./types.js";

const agentIdSchema = z.enum(AGENT_IDS);
const agentFileSchema = z.object({
  id: agentIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  triggers: z.array(z.string().min(1)),
  context: z.object({
    read: z.array(z.string().min(1)),
    write: z.array(z.string().min(1)),
  }),
  tools: z.object({
    allow: z.array(z.string().min(1)),
    deny: z.array(z.string().min(1)),
  }),
  outputs: z.object({ schema: z.string().min(1) }),
  approval: z.object({ required_for: z.array(z.string().min(1)) }),
});

export class AgentRegistry {
  private constructor(private readonly definitions: Map<AgentId, AgentDefinition>) {}

  static async load(root: string): Promise<AgentRegistry> {
    const agentsDirectory = path.join(root, "agents");
    const entries = await readdir(agentsDirectory, { withFileTypes: true });
    const definitions = new Map<AgentId, AgentDefinition>();

    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const directory = path.join(agentsDirectory, entry.name);
      const parsed = agentFileSchema.parse(parse(await readFile(path.join(directory, "agent.yaml"), "utf8")));
      if (entry.name !== parsed.id) throw new Error(`Agent directory ${entry.name} does not match id ${parsed.id}`);
      if (definitions.has(parsed.id)) throw new Error(`Duplicate agent id: ${parsed.id}`);

      const instructions = await readFile(path.join(directory, "instructions.md"), "utf8");
      const schemaPath = path.resolve(root, parsed.outputs.schema);
      const relativeSchemaPath = path.relative(root, schemaPath);
      if (relativeSchemaPath.startsWith("..") || path.isAbsolute(relativeSchemaPath)) {
        throw new Error(`Output schema escapes repository: ${parsed.outputs.schema}`);
      }
      const outputSchema = JSON.parse(await readFile(schemaPath, "utf8")) as Record<string, unknown>;
      definitions.set(parsed.id, { ...parsed, instructions, outputSchema });
    }

    const missing = AGENT_IDS.filter((id) => !definitions.has(id));
    if (missing.length > 0) throw new Error(`Missing required agents: ${missing.join(", ")}`);
    return new AgentRegistry(definitions);
  }

  get(id: AgentId): AgentDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown agent: ${id}`);
    return definition;
  }

  list(): AgentDefinition[] {
    return AGENT_IDS.map((id) => this.get(id));
  }
}

export function isAgentId(value: string): value is AgentId {
  return AGENT_IDS.includes(value as AgentId);
}
