import assert from "node:assert/strict";
import test from "node:test";
import { decideDeadlineFollowUp } from "../src/matter_workflows.js";

const now = new Date("2026-09-26T12:00:00Z");

test("an unsigned document past its deadline is escalated", () => {
  assert.deepEqual(
    decideDeadlineFollowUp({ deadline_at: "2026-09-25T17:00:00Z" }, false, now),
    { action: "escalate_overdue" },
  );
});

test("a signed document closes follow-up even when its deadline passed", () => {
  assert.deepEqual(
    decideDeadlineFollowUp({ deadline_at: "2026-09-25T17:00:00Z" }, true, now),
    { action: "close_follow_up" },
  );
});
