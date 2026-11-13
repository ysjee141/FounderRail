import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { initializeConfig, loadConfig } from "../src/config.js";

test("initializes and loads a selected runtime", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const created = await initializeConfig(root, "codex");
  const loaded = await loadConfig(root);
  assert.deepEqual(loaded, created);
  assert.match(await readFile(path.join(root, ".agent-team", "config.json"), "utf8"), /"runtime": "codex"/);
});

test("refuses to overwrite an initialized team", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-team-config-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeConfig(root, "codex");
  await assert.rejects(() => initializeConfig(root, "claude"), { code: "EEXIST" });
});
