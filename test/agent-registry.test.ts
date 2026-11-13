import assert from "node:assert/strict";
import test from "node:test";
import { compileAgentPrompt } from "../src/agents/prompt.js";
import { AgentRegistry } from "../src/agents/registry.js";

test("loads the five required business agents in stable order", async () => {
  const registry = await AgentRegistry.load(process.cwd());
  assert.deepEqual(registry.list().map((agent) => agent.id), [
    "founder-office",
    "product-growth",
    "engineering",
    "finance-ops",
    "risk-quality",
  ]);
});

test("compiles role, policy, request and output schema into a bounded prompt", async () => {
  const registry = await AgentRegistry.load(process.cwd());
  const prompt = compileAgentPrompt(registry.get("finance-ops"), "이번 달 runway를 검토해줘.");
  assert.match(prompt, /Finance & Operations/);
  assert.match(prompt, /company\/finance\/\*\*/);
  assert.match(prompt, /bank\.transfer/);
  assert.match(prompt, /requested_next_agent/);
  assert.match(prompt, /이번 달 runway를 검토해줘/);
  assert.doesNotMatch(prompt, /company\/risk\/\*\*/);
});
