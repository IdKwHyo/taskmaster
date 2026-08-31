import assert from "node:assert/strict";
import test from "node:test";
import { briefMission, buildDailyBriefing, classifyHenryCommand, runHenryCommand } from "../lib/henry-command.ts";
import { createScenarioMission, seedMission } from "../lib/henry-prototype.ts";

test("classifyHenryCommand recognizes operational language", () => {
  assert.equal(classifyHenryCommand("What needs my attention today?"), "briefing");
  assert.equal(classifyHenryCommand("What's on my day?"), "day_plan");
  assert.equal(classifyHenryCommand("Show today's schedule"), "day_plan");
  assert.equal(classifyHenryCommand("Why are you waiting?"), "explain");
  assert.equal(classifyHenryCommand("Show me the calendar"), "inspect_calendar");
  assert.equal(classifyHenryCommand("How much did this cost?"), "inspect_cost");
  assert.equal(classifyHenryCommand("A rejected the time"), "external_reject");
  assert.equal(classifyHenryCommand("Looks good, go ahead"), "approve");
});

test("buildDailyBriefing combines agenda and mission boundary context", () => {
  const mission = createScenarioMission("approval_needed", "2026-08-17T08:00:00.000Z");
  const response = buildDailyBriefing(mission);
  assert.equal(response.intent, "day_plan");
  assert.equal(response.agenda?.items.length, 3);
  assert.equal(response.agenda?.focusWindow, "11:45–14:00");
  assert.match(response.summary, /needs your approval/i);
  assert.match(response.speech, /three commitments/i);
  assert.equal(response.facts[2].surface, "approval");
  assert.equal(response.changedMission, false);
});

test("daily question returns an inspectable agenda without mutating the mission", () => {
  const mission = seedMission();
  const result = runHenryCommand("What's on my day?", mission);
  assert.equal(result.mission, mission);
  assert.equal(result.response.intent, "day_plan");
  assert.equal(result.response.surface, "none");
  assert.equal(result.response.facts[0].surface, "calendar");
  assert.match(result.response.recommendation, /focus/i);
});

test("briefMission is derived from current engine state and events", () => {
  const mission = seedMission();
  const response = briefMission(mission);
  assert.equal(response.intent, "briefing");
  assert.match(response.headline, /asleep/i);
  assert.equal(response.facts[0].value, "WAITING EXTERNAL");
  assert.equal(response.facts[1].value, mission.events[0].title);
  assert.equal(response.sourceEventIds[0], mission.events[0].id);
  assert.equal(response.changedMission, false);
});

test("conversational rejection wakes the mission on a protected fallback", () => {
  const mission = seedMission();
  const result = runHenryCommand("A said no to Tuesday", mission);
  assert.equal(result.response.intent, "external_reject");
  assert.equal(result.response.changedMission, true);
  assert.equal(result.mission.status, "RUNNING");
  assert.equal(result.mission.twin.state, "FALLBACK");
  assert.match(result.mission.events[0].title, /fallback/i);
  assert.ok(result.response.sourceEventIds.includes(result.mission.events[0].id));
});

test("conversational approval crosses the boundary and records evidence", () => {
  const mission = createScenarioMission("approval_needed", "2026-08-17T08:00:00.000Z");
  const result = runHenryCommand("Approve it", mission);
  assert.equal(result.mission.status, "RUNNING");
  assert.equal(result.mission.currentStep, 5);
  assert.equal(result.response.changedMission, true);
  assert.match(result.mission.events[0].detail, /APPROVED/);
});

test("invalid conversational actions do not mutate mission state", () => {
  const mission = seedMission();
  const result = runHenryCommand("Approve it", mission);
  assert.equal(result.mission, mission);
  assert.equal(result.response.intent, "unknown");
  assert.equal(result.response.changedMission, false);
  assert.match(result.response.summary, /does not apply/i);
});

test("calendar and cost commands route to evidence surfaces without execution", () => {
  const mission = seedMission();
  const calendar = runHenryCommand("Open the calendar", mission);
  const cost = runHenryCommand("Show mission cost", mission);
  assert.equal(calendar.response.surface, "calendar");
  assert.equal(cost.response.surface, "cost");
  assert.equal(calendar.mission, mission);
  assert.equal(cost.mission, mission);
});
