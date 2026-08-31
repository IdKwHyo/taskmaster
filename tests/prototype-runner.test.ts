import assert from "node:assert/strict";
import test from "node:test";
import { createMission, createScenarioMission, runPrototypeAction, seedMission, type PrototypeMission } from "../lib/henry-prototype.ts";
import { mapCloudMission, runCloudAction } from "../lib/henry-cloud.ts";

test("createMission creates a bounded runnable workflow", () => {
  const mission = createMission("  Prepare   the launch review  ", "m-101", "2026-08-13T01:02:03.004Z");
  assert.equal(mission.id, "m-101");
  assert.equal(mission.outcome, "Prepare the launch review");
  assert.equal(mission.status, "RUNNING");
  assert.equal(mission.steps.length, 6);
  assert.equal(mission.steps[0].state, "active");
  assert.equal(mission.modelCalls, 0);
  assert.equal(mission.twin.routes.length, 3);
  assert.equal(mission.twin.selectedRouteId, "route-a");
  assert.equal(mission.twin.routes[0].score, 92);
  assert.equal(mission.artifacts.calendarScan.freeSlots.length, 3);
  assert.match(mission.artifacts.outboundMessage.body, /Prepare the launch review/);
  assert.throws(() => createMission("   "), /outcome is required/i);
});

test("seedMission starts at an inspectable external wait", () => {
  const mission = seedMission();
  assert.equal(mission.id, "m-204");
  assert.equal(mission.status, "WAITING_EXTERNAL");
  assert.equal(mission.currentStep, 3);
  assert.equal(mission.steps[3].state, "waiting");
});

test("runPrototypeAction progresses, suspends, resumes, and completes", () => {
  let mission = createMission("Coordinate a review", "m-202", "2026-08-13T01:02:03.004Z");
  mission = runPrototypeAction({ type: "advance", mission });
  assert.equal(mission.currentStep, 1);
  assert.equal(mission.twin.state, "EXECUTING");
  mission = runPrototypeAction({ type: "advance", mission });
  mission = runPrototypeAction({ type: "advance", mission });
  assert.equal(mission.status, "WAITING_EXTERNAL");
  assert.equal(mission.currentStep, 3);

  mission = runPrototypeAction({ type: "external_reply", mission });
  assert.equal(mission.status, "NEEDS_APPROVAL");
  assert.equal(mission.steps[4].state, "waiting");

  mission = runPrototypeAction({ type: "approve", mission });
  assert.equal(mission.status, "RUNNING");
  assert.equal(mission.steps[5].state, "active");

  mission = runPrototypeAction({ type: "advance", mission });
  assert.equal(mission.status, "COMPLETED");
  assert.ok(mission.steps.every((step) => step.state === "done"));
  assert.equal(mission.modelCalls, 0);
  assert.equal(mission.twin.state, "VERIFIED");
  assert.match(mission.artifacts.calendarEvent.eventId, /^evt-/);
});

test("runPrototypeAction pauses safely and blocks progress until resumed", () => {
  let mission = createMission("Prepare a briefing", "m-303", "2026-08-13T01:02:03.004Z");
  mission = runPrototypeAction({ type: "toggle_pause", mission });
  assert.equal(mission.paused, true);
  assert.throws(() => runPrototypeAction({ type: "advance", mission }), /resume the mission/i);
  mission = runPrototypeAction({ type: "toggle_pause", mission });
  assert.equal(mission.paused, false);
});

test("runPrototypeAction declines without performing the final action", () => {
  const waiting = seedMission();
  const approval = runPrototypeAction({ type: "external_reply", mission: waiting });
  const cancelled = runPrototypeAction({ type: "reject", mission: approval });
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(cancelled.steps[5].state, "locked");
  assert.match(cancelled.events[0].detail, /NO CHANGES/);
});

test("runPrototypeAction rejects malformed mission state", () => {
  const malformed = { id: "m-bad", steps: [] } as unknown as PrototypeMission;
  assert.throws(() => runPrototypeAction({ type: "advance", mission: malformed }), /invalid mission state/i);
});

test("test scenarios expose waiting and approval boundaries directly", () => {
  const waiting = createScenarioMission("waiting_reply", "2026-08-13T01:02:03.004Z");
  const approval = createScenarioMission("approval_needed", "2026-08-13T01:02:03.004Z");
  const completed = createScenarioMission("completed", "2026-08-13T01:02:03.004Z", "Prepare weekly operations report");
  assert.equal(waiting.status, "WAITING_EXTERNAL");
  assert.equal(waiting.currentStep, 3);
  assert.equal(approval.status, "NEEDS_APPROVAL");
  assert.equal(approval.currentStep, 4);
  assert.equal(completed.status, "COMPLETED");
  assert.equal(completed.outcome, "Prepare weekly operations report");
  assert.equal(completed.twin.state, "VERIFIED");
  assert.ok(completed.steps.every((step) => step.state === "done"));
});

test("Mission Twin falls back to a pre-validated route without restarting", () => {
  const waiting = createScenarioMission("waiting_reply", "2026-08-13T01:02:03.004Z");
  const recovered = runPrototypeAction({ type: "external_reject", mission: waiting });
  assert.equal(recovered.status, "RUNNING");
  assert.equal(recovered.currentStep, 3);
  assert.equal(recovered.twin.state, "FALLBACK");
  assert.equal(recovered.twin.selectedRouteId, "route-b");
  assert.equal(recovered.twin.routes.find((route) => route.id === "route-a")?.status, "failed");
  assert.match(recovered.artifacts.externalReply, /Wed 09:30/);
  assert.match(recovered.events[1].detail, /NO SECOND MESSAGE/);
  const approval = runPrototypeAction({ type: "advance", mission: recovered });
  assert.equal(approval.status, "NEEDS_APPROVAL");
});

test("failure scenarios stop safely with visible fault context", () => {
  const calendarFailure = createScenarioMission("calendar_failure", "2026-08-13T01:02:03.004Z");
  const budgetLimit = runPrototypeAction({ type: "scenario", scenario: "budget_limit" });
  assert.equal(calendarFailure.paused, true);
  assert.equal(calendarFailure.simulation?.kind, "calendar_failure");
  assert.match(calendarFailure.simulation?.code ?? "", /504/);
  assert.equal(budgetLimit.estimatedCost, .02);
  assert.match(budgetLimit.simulation?.code ?? "", /LIMIT REACHED/);
});

test("cloud mission mapper preserves authority, waits, evidence, and cost", () => {
  const mission = mapCloudMission({
    id: "m-cloud-101",
    outcome: "Coordinate a review with A",
    status: "WAITING_APPROVAL",
    current_step_index: 4,
    created_at: "2026-08-21T01:00:00.000Z",
    updated_at: "2026-08-21T01:03:00.000Z",
    usage: { model_calls: 1, tool_calls: 2, estimated_model_cost_usd: 0.0042 },
    authority: {
      allowed_actions: ["inspect_calendar", "contact_attendee_once"],
      approval_required_for: ["create_calendar_event"],
      forbidden_actions: ["move_existing_commitments"],
      spend_limit_usd: 0.10,
      completion_contract: ["event_read_back_matches_approved_slot"],
    },
    steps: [
      { id: "s1", name: "Plan outcome", kind: "PLAN", status: "COMPLETED", output: {} },
      { id: "s2", name: "Inspect calendars", kind: "CHECK_CALENDAR", status: "COMPLETED", output: { available_slots: ["2026-08-25T15:30:00+07:00"] } },
      { id: "s3", name: "Contact A", kind: "CONTACT_ATTENDEE", status: "COMPLETED", output: { recipient: "A", status: "sent" } },
      { id: "s4", name: "Wait", kind: "WAIT_EXTERNAL", status: "COMPLETED", output: { selected_slot: "2026-08-25T15:30:00+07:00" } },
      { id: "s5", name: "Approve write", kind: "APPROVAL", status: "WAITING", output: {} },
      { id: "s6", name: "Verify event", kind: "BOOK_AND_CONFIRM", status: "PENDING", output: {} },
    ],
  }, [{ id: "evt-1", event_type: "STEP_WAITING", message: "Paused at the human approval boundary.", created_at: "2026-08-21T01:03:00.000Z" }]);

  assert.equal(mission.backend, "cloud");
  assert.equal(mission.status, "NEEDS_APPROVAL");
  assert.equal(mission.steps[4].state, "waiting");
  assert.equal(mission.authority?.spendLimitUsd, 0.10);
  assert.equal(mission.estimatedCost, 0.0042);
  assert.equal(mission.artifacts.calendarScan.freeSlots[0], "2026-08-25T15:30:00+07:00");
  assert.match(mission.events[0].title, /approval boundary/i);
});

test("cloud adapter polls through the server-side credential boundary", async () => {
  const cloudMission = {
    id: "m-cloud-202",
    outcome: "Coordinate a review with A",
    status: "RUNNING",
    current_step_index: 1,
    created_at: "2026-08-21T01:00:00.000Z",
    updated_at: "2026-08-21T01:01:00.000Z",
    usage: { model_calls: 1, tool_calls: 0, estimated_model_cost_usd: 0.001 },
    authority: { allowed_actions: [], approval_required_for: ["create_calendar_event"], forbidden_actions: [], spend_limit_usd: 0.10, completion_contract: ["calendar_event_created"] },
    steps: [{ id: "s1", name: "Plan", kind: "PLAN", status: "COMPLETED", output: {} }],
  };
  const local = createMission(cloudMission.outcome, cloudMission.id, cloudMission.created_at);
  local.backend = "cloud";
  const urls: string[] = [];
  const fetcher = async (input: URL | RequestInfo) => {
    const url = String(input);
    urls.push(url);
    return Response.json(url.endsWith("/events") ? { events: [] } : cloudMission);
  };

  const result = await runCloudAction({ baseUrl: "https://henry.example/", apiKey: "server-only", fetcher }, { type: "advance", mission: local });
  assert.equal(result.backend, "cloud");
  assert.deepEqual(urls, [
    "https://henry.example/api/v1/missions/m-cloud-202",
    "https://henry.example/api/v1/missions/m-cloud-202/events",
  ]);
});
