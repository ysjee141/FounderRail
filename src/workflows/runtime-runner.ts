import path from "node:path";
import { compileAgentPrompt } from "../agents/prompt.js";
import { AgentRegistry } from "../agents/registry.js";
import { loadConfig, stateDirectory } from "../config.js";
import { loadAgentContext } from "../context/loader.js";
import { JsonlEventStore } from "../events/jsonl-store.js";
import { getRuntimeAdapter } from "../runtime/registry.js";
import { parseAgentRuntimeResult } from "../runtime/result-contract.js";
import type { AgentStepRunner } from "./executor.js";

export async function createRuntimeWorkflowRunner(root: string, timeoutMs = 300_000): Promise<AgentStepRunner> {
  const config = await loadConfig(root);
  const adapter = getRuntimeAdapter(config.runtime);
  const registry = await AgentRegistry.load(root);
  const events = new JsonlEventStore(path.join(stateDirectory(root), "events"));

  return async ({ workflow, step, task, priorHandoffs }) => {
    const agent = registry.get(step.agent);
    const context = await loadAgentContext(root, agent);
    const request = [
      `Workflow: ${workflow.id}`,
      `Step: ${step.id}`,
      "",
      "## Step instruction",
      step.prompt,
      "",
      "## Task contract",
      JSON.stringify(task, null, 2),
      "",
      "## Validated prior handoffs",
      JSON.stringify(priorHandoffs, null, 2),
    ].join("\n");
    const prompt = compileAgentPrompt(agent, request, context);
    const result = await adapter.run(
      {
        prompt,
        cwd: root,
        mode: "read-only",
        timeoutMs,
        outputSchema: { schema: agent.outputSchema, path: path.resolve(root, agent.outputs.schema) },
      },
      (event) => events.append(event),
    );
    return parseAgentRuntimeResult(result);
  };
}
