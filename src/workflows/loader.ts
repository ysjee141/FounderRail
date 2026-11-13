import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { workflowDefinitionSchema, type WorkflowDefinition } from "./types.js";

export class InvalidWorkflowError extends Error {}

function validateGraph(workflow: WorkflowDefinition): void {
  const ids = workflow.steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) throw new InvalidWorkflowError(`Duplicate step id in ${workflow.id}`);
  const idSet = new Set(ids);
  for (const step of workflow.steps) {
    for (const dependency of step.requires) {
      if (!idSet.has(dependency)) throw new InvalidWorkflowError(`Unknown dependency ${dependency} in step ${step.id}`);
      if (dependency === step.id) throw new InvalidWorkflowError(`Step ${step.id} depends on itself`);
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dependencies = new Map(workflow.steps.map((step) => [step.id, step.requires]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new InvalidWorkflowError(`Dependency cycle detected at ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

export async function loadWorkflow(root: string, id: string, definitionsRoot = root): Promise<WorkflowDefinition> {
  if (!/^[a-z0-9-]+$/.test(id)) throw new InvalidWorkflowError(`Invalid workflow id: ${id}`);
  const file = path.join(definitionsRoot, "workflows", `${id}.yaml`);
  const workflow = workflowDefinitionSchema.parse(parse(await readFile(file, "utf8")));
  if (workflow.id !== id) throw new InvalidWorkflowError(`Workflow file name and id differ: ${id} != ${workflow.id}`);
  validateGraph(workflow);
  return workflow;
}

export function validateWorkflow(value: unknown): WorkflowDefinition {
  const workflow = workflowDefinitionSchema.parse(value);
  validateGraph(workflow);
  return workflow;
}
