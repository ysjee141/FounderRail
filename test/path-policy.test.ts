import assert from "node:assert/strict";
import test from "node:test";
import { canReadPath, canWritePath, matchesScope } from "../src/agents/path-policy.js";

test("matches exact and recursive document scopes", () => {
  assert.equal(matchesScope("company/goals.md", "company/goals.md"), true);
  assert.equal(matchesScope("company/finance/runway.md", "company/finance/**"), true);
  assert.equal(matchesScope("company/finances/runway.md", "company/finance/**"), false);
});

test("rejects absolute paths and traversal", () => {
  assert.equal(canWritePath(["company/finance/**"], "../company/finance/runway.md"), false);
  assert.equal(canWritePath(["company/finance/**"], "/company/finance/runway.md"), false);
  assert.equal(canReadPath(["company/**"], "company/../secrets.txt"), false);
  assert.equal(canWritePath(["company/finance/**"], "company/finance/../finance/runway.md"), false);
});

test("finance cannot write another agent's documents", () => {
  const scopes = ["company/finance/**"];
  assert.equal(canWritePath(scopes, "company/finance/runway.md"), true);
  assert.equal(canWritePath(scopes, "company/risk/register.md"), false);
  assert.equal(canWritePath(scopes, "company/strategy.md"), false);
});
