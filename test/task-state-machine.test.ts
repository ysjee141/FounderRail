import assert from "node:assert/strict";
import test from "node:test";
import { allowedTaskTransitions, assertTaskTransition, InvalidTaskTransitionError } from "../src/tasks/state-machine.js";

test("allows only declared task transitions", () => {
  assert.doesNotThrow(() => assertTaskTransition("draft", "ready"));
  assert.deepEqual(allowedTaskTransitions("completed"), []);
  assert.throws(() => assertTaskTransition("draft", "completed"), InvalidTaskTransitionError);
  assert.throws(() => assertTaskTransition("completed", "running"), InvalidTaskTransitionError);
});
