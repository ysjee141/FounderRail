import path from "node:path";
import { compileAgentPrompt } from "../agents/prompt.js";
import { canWritePath } from "../agents/path-policy.js";
import { AgentRegistry } from "../agents/registry.js";
import { loadConfig, stateDirectory } from "../config.js";
import { loadAgentContext } from "../context/loader.js";
import { JsonlEventStore } from "../events/jsonl-store.js";
import {
  collectWorktreeEvidence,
  ensureEngineeringWorktree,
  loadEngineeringWorktree,
  type EngineeringWorktree,
} from "../engineering/worktree.js";
import { getRuntimeAdapter } from "../runtime/registry.js";
import { parseAgentRuntimeResult } from "../runtime/result-contract.js";
import type { RuntimeMode } from "../runtime/types.js";
import type { AgentResult } from "../tasks/contracts.js";
import type { AgentDefinition } from "../agents/types.js";
import type { AgentStepRunner } from "./executor.js";

export interface RuntimeAgentExecution {
  agent: AgentDefinition;
  prompt: string;
  cwd: string;
  mode: RuntimeMode;
  timeoutMs: number;
  outputSchemaPath: string;
}

export type RuntimeAgentExecutor = (execution: RuntimeAgentExecution) => Promise<AgentResult>;

export async function createRuntimeWorkflowRunner(
  root: string,
  timeoutMs = 300_000,
  injectedExecutor?: RuntimeAgentExecutor,
): Promise<AgentStepRunner> {
  const adapter = injectedExecutor ? undefined : getRuntimeAdapter((await loadConfig(root)).runtime);
  const registry = await AgentRegistry.load(root);
  const events = new JsonlEventStore(path.join(stateDirectory(root), "events"));

  return async ({ workflow, step, task, priorHandoffs }) => {
    const agent = registry.get(step.agent);
    let cwd = root;
    let mode: RuntimeMode = "read-only";
    let worktree: EngineeringWorktree | undefined;
    if (step.execution === "engineering-implement") {
      worktree = await ensureEngineeringWorktree(root, task.id);
      cwd = worktree.path;
      mode = "workspace-write";
    } else if (step.execution === "engineering-review") {
      worktree = await loadEngineeringWorktree(root, task.id);
      cwd = worktree.path;
    }
    const context = await loadAgentContext(root, agent);
    const request = [
      `Workflow: ${workflow.id}`,
      `Step: ${step.id}`,
      `Execution phase: ${step.execution}`,
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
    const prompt = compileAgentPrompt(agent, request, context, {
      writablePaths: step.execution === "engineering-implement" ? task.scope.writable_paths : [],
      forbiddenActions: task.scope.forbidden_actions,
    });
    const outputSchemaPath = path.resolve(cwd, agent.outputs.schema);
    const parsed = injectedExecutor
      ? await injectedExecutor({ agent, prompt, cwd, mode, timeoutMs, outputSchemaPath })
      : parseAgentRuntimeResult(await adapter!.run(
          {
            prompt,
            cwd,
            mode,
            timeoutMs,
            outputSchema: { schema: agent.outputSchema, path: outputSchemaPath },
          },
          (event) => events.append(event),
        ));
    if (!worktree) return parsed;

    const evidence = await collectWorktreeEvidence(root, worktree);
    const outsideScope = evidence.changedFiles.filter((file) => !canWritePath(task.scope.writable_paths, file));
    if (outsideScope.length > 0) {
      throw new Error(`Engineering changes escaped Task writable scope: ${outsideScope.join(", ")}`);
    }
    if (!evidence.diffCheckPassed) throw new Error(`Engineering diff check failed: ${evidence.diffCheckOutput}`);
    return {
      ...parsed,
      artifacts: [...new Set([
        ...parsed.artifacts,
        `git-branch:${evidence.branch}`,
        `git-head:${evidence.headCommit}`,
        ...evidence.changedFiles.map((file) => `changed-file:${file}`),
      ])],
      evidence: [
        ...parsed.evidence,
        { claim: "git diff --check passed", source: `git:${evidence.baseCommit}..${evidence.headCommit}` },
        { claim: `changed files: ${evidence.changedFiles.join(", ") || "none"}`, source: `git-branch:${evidence.branch}` },
      ],
    };
  };
}
