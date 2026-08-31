import { activateTwin, createMissionTwin, fallbackTwin, selectedRoute, verifyTwin, type MissionTwin } from "./mission-twin.ts";

export type MissionStatus =
  | "RUNNING"
  | "WAITING_EXTERNAL"
  | "NEEDS_APPROVAL"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export type MissionStepState = "done" | "active" | "waiting" | "locked";

export type MissionStep = {
  id: "plan" | "context" | "act" | "wait" | "approval" | "done";
  label: string;
  state: MissionStepState;
  icon: "plan" | "calendar" | "message" | "wait" | "approval" | "done";
  x: number;
  y: number;
};

export type MissionEvent = {
  id: string;
  title: string;
  time: string;
  detail: string;
  tone: "neutral" | "live" | "waiting" | "warning";
};

export type MissionArtifacts = {
  plan: string[];
  calendarScan: {
    calendarsChecked: number;
    busyEvents: string[];
    freeSlots: string[];
  };
  outboundMessage: {
    recipient: string;
    body: string;
  };
  externalReply: string;
  calendarEvent: {
    title: string;
    date: string;
    time: string;
    eventId: string;
  };
};

export type PrototypeMission = {
  id: string;
  backend?: "local" | "cloud";
  engineStatus?: string;
  outcome: string;
  status: MissionStatus;
  currentStep: number;
  paused: boolean;
  startedAt: string;
  updatedAt: string;
  estimatedCost: number;
  modelCalls: number;
  toolCalls: number;
  steps: MissionStep[];
  events: MissionEvent[];
  artifacts: MissionArtifacts;
  twin: MissionTwin;
  authority?: {
    allowedActions: string[];
    approvalRequiredFor: string[];
    forbiddenActions: string[];
    spendLimitUsd: number;
    completionContract: string[];
  };
  simulation?: {
    kind: "calendar_failure" | "gmail_failure" | "budget_limit";
    title: string;
    detail: string;
    code: string;
  };
};

export type PrototypeScenario = "standard" | "waiting_reply" | "approval_needed" | "route_fallback" | "completed" | "calendar_failure" | "gmail_failure" | "budget_limit";

export type PrototypeAction =
  | { type: "create"; outcome: string }
  | { type: "command"; query: string; mission: PrototypeMission }
  | { type: "advance"; mission: PrototypeMission }
  | { type: "external_reply"; mission: PrototypeMission }
  | { type: "external_reject"; mission: PrototypeMission }
  | { type: "approve"; mission: PrototypeMission }
  | { type: "reject"; mission: PrototypeMission }
  | { type: "toggle_pause"; mission: PrototypeMission }
  | { type: "scenario"; scenario: PrototypeScenario; outcome?: string };

const STEP_TEMPLATE: MissionStep[] = [
  { id: "plan", label: "Shadow-run routes", state: "locked", icon: "plan", x: 16, y: 38 },
  { id: "context", label: "Check context", state: "locked", icon: "calendar", x: 240, y: 38 },
  { id: "act", label: "Contact dependency", state: "locked", icon: "message", x: 468, y: 38 },
  { id: "wait", label: "Await response", state: "locked", icon: "wait", x: 590, y: 142 },
  { id: "approval", label: "Human approval", state: "locked", icon: "approval", x: 428, y: 214 },
  { id: "done", label: "Finish outcome", state: "locked", icon: "done", x: 182, y: 214 },
];

const ACTION_DETAILS = [
  "twin.simulate · 3 ROUTES · 48ms",
  "context.query · 200 OK · 71ms",
  "external.message · 202 ACCEPTED · 96ms",
  "signal.wait · SUSPENDED",
  "approval.request · BOUNDARY",
  "workflow.complete · 200 OK · 34ms",
];

function now() {
  return new Date().toISOString();
}

function displayTime(value: string) {
  return `${value.slice(11, 23)} UTC`;
}

function missionId() {
  return `m-${Math.floor(100 + Math.random() * 900)}`;
}

function event(title: string, detail: string, tone: MissionEvent["tone"], at = now()): MissionEvent {
  return { id: `${at}-${title}`, title, time: displayTime(at), detail, tone };
}

function stepsAt(currentStep: number, currentState: MissionStepState): MissionStep[] {
  return STEP_TEMPLATE.map((step, index) => ({
    ...step,
    state: index < currentStep ? "done" : index === currentStep ? currentState : "locked",
  }));
}

function artifactsFor(outcome: string, id: string): MissionArtifacts {
  return {
    plan: ["Check both calendars", "Offer conflict-free times", "Wait without polling", "Request approval before booking"],
    calendarScan: {
      calendarsChecked: 2,
      busyEvents: ["Tue 14:00 · Product sync", "Wed 10:30 · Design review"],
      freeSlots: ["Tue 15:30", "Wed 09:30", "Thu 14:00"],
    },
    outboundMessage: {
      recipient: "A",
      body: `I’m coordinating “${outcome}”. Graphic is free Tue 15:30, Wed 09:30, or Thu 14:00. Which works for you?`,
    },
    externalReply: "Tue 15:30 works for me.",
    calendarEvent: {
      title: outcome,
      date: "Tue 18 Aug",
      time: "15:30–16:00",
      eventId: `evt-${id.slice(2)}-0818`,
    },
  };
}

export function createMission(outcome: string, id = missionId(), at = now()): PrototypeMission {
  const cleanOutcome = outcome.trim().replace(/\s+/g, " ").slice(0, 240);
  if (!cleanOutcome) throw new Error("An outcome is required.");

  return {
    id,
    backend: "local",
    outcome: cleanOutcome,
    status: "RUNNING",
    currentStep: 0,
    paused: false,
    startedAt: at,
    updatedAt: at,
    estimatedCost: 0,
    modelCalls: 0,
    toolCalls: 0,
    steps: stepsAt(0, "active"),
    events: [event("Outcome accepted from dashboard", "POST /api/prototype · 202 ACCEPTED", "neutral", at)],
    artifacts: artifactsFor(cleanOutcome, id),
    twin: createMissionTwin(cleanOutcome, at),
  };
}

export function seedMission(): PrototypeMission {
  const at = "2026-08-12T11:19:04.222Z";
  const mission = createMission("Coordinate a 30-minute project review with A before Thursday", "m-204", at);
  return {
    ...mission,
    status: "WAITING_EXTERNAL",
    currentStep: 3,
    updatedAt: "2026-08-12T11:21:14.083Z",
    estimatedCost: 0.003,
    toolCalls: 2,
    twin: activateTwin(mission.twin),
    steps: stepsAt(3, "waiting"),
    events: [
      event("Requested A's availability", "external.message · 202 ACCEPTED · 96ms", "waiting", "2026-08-12T11:21:14.083Z"),
      event("Found three conflict-free windows", "context.query · 200 OK · 71ms", "live", "2026-08-12T11:20:51.441Z"),
      event("Selected safest shadow route", "twin.simulate · ROUTE_A · 92/100", "live", "2026-08-12T11:19:09.812Z"),
      mission.events[0],
    ],
  };
}

export function createScenarioMission(scenario: PrototypeScenario, at = now(), outcome = "Coordinate a 30-minute project review with A next week"): PrototypeMission {
  const mission = createMission(outcome, missionId(), at);
  if (scenario === "standard") return mission;
  if (scenario === "waiting_reply") {
    return {
      ...mission,
      status: "WAITING_EXTERNAL",
      currentStep: 3,
      estimatedCost: .002,
      toolCalls: 2,
      twin: activateTwin(mission.twin),
      steps: stepsAt(3, "waiting"),
      events: [event("Waiting for A's reply", "signal.wait · SUSPENDED", "waiting", at), ...mission.events],
    };
  }
  if (scenario === "approval_needed") {
    return {
      ...mission,
      status: "NEEDS_APPROVAL",
      currentStep: 4,
      estimatedCost: .003,
      toolCalls: 2,
      twin: activateTwin(mission.twin),
      steps: stepsAt(4, "waiting"),
      events: [event("External reply received", "signal.external_reply · Tue 15:30", "warning", at), ...mission.events],
    };
  }
  if (scenario === "completed") {
    return {
      ...mission,
      status: "COMPLETED",
      currentStep: 5,
      estimatedCost: .009,
      toolCalls: 4,
      twin: verifyTwin(activateTwin(mission.twin)),
      steps: stepsAt(6, "done"),
      events: [
        event("Outcome verified", "workflow.complete · READ_BACK_OK · 34ms", "live", at),
        event("Calendar write approved", "approval.resolve · APPROVED", "live", at),
        ...mission.events,
      ],
    };
  }
  if (scenario === "route_fallback") {
    const twin = fallbackTwin(activateTwin(mission.twin));
    const route = selectedRoute(twin);
    return {
      ...mission,
      status: "RUNNING",
      currentStep: 2,
      estimatedCost: .003,
      toolCalls: 2,
      twin,
      steps: stepsAt(2, "active"),
      artifacts: {
        ...mission.artifacts,
        outboundMessage: { recipient: "A", body: `Tuesday is no longer available. I can hold ${route.slot} or Thu 14:00 for “${mission.outcome}”. Which works for you?` },
        externalReply: "Wednesday 09:30 works for me.",
        calendarEvent: { ...mission.artifacts.calendarEvent, date: "Wed 19 Aug", time: "09:30–10:00" },
      },
      events: [event("Shadow route A invalidated", "twin.fallback · ROUTE_B · 31ms", "warning", at), ...mission.events],
    };
  }

  const fault = scenario === "calendar_failure"
    ? { step: 1, cost: .001, tools: 1, title: "Google Calendar did not respond", detail: "The read timed out before Henry could calculate availability.", code: "CALENDAR.EVENTS.LIST · 504" }
    : scenario === "gmail_failure"
      ? { step: 2, cost: .002, tools: 2, title: "Gmail rejected the message", detail: "Henry preserved the draft and stopped before entering a wait state.", code: "GMAIL.MESSAGES.SEND · 503" }
      : { step: 2, cost: .020, tools: 2, title: "Mission budget reached", detail: "Henry stopped before another paid action could begin.", code: "BUDGET.GUARD · LIMIT REACHED" };
  return {
    ...mission,
    status: "RUNNING",
    currentStep: fault.step,
    paused: true,
    estimatedCost: fault.cost,
    toolCalls: fault.tools,
    twin: activateTwin(mission.twin),
    steps: stepsAt(fault.step, "waiting"),
    simulation: { kind: scenario, title: fault.title, detail: fault.detail, code: fault.code },
    events: [event(fault.title, fault.code, "warning", at), ...mission.events],
  };
}

function ensureMission(mission: PrototypeMission) {
  if (!mission?.id || !Array.isArray(mission.steps) || mission.steps.length !== STEP_TEMPLATE.length) {
    throw new Error("Invalid mission state.");
  }
}

export function runPrototypeAction(action: PrototypeAction): PrototypeMission {
  if (action.type === "command") throw new Error("Command actions must use the Henry command interpreter.");
  if (action.type === "create") return createMission(action.outcome);
  if (action.type === "scenario") return createScenarioMission(action.scenario, now(), action.outcome);

  ensureMission(action.mission);
  const mission = action.mission;
  const at = now();

  if (action.type === "toggle_pause") {
    if (!["RUNNING", "WAITING_EXTERNAL"].includes(mission.status)) return mission;
    const paused = !mission.paused;
    return {
      ...mission,
      paused,
      updatedAt: at,
      events: [event(paused ? "Mission paused safely" : "Mission resumed", `workflow.${paused ? "pause" : "resume"} · 200 OK`, paused ? "warning" : "live", at), ...mission.events],
    };
  }

  if (mission.paused) throw new Error("Resume the mission before continuing.");

  if (action.type === "advance") {
    if (mission.status !== "RUNNING") return mission;
    const completed = mission.currentStep;
    if (completed >= STEP_TEMPLATE.length - 1) {
      return {
        ...mission,
        status: "COMPLETED",
        steps: stepsAt(STEP_TEMPLATE.length, "done"),
        updatedAt: at,
        estimatedCost: Number((mission.estimatedCost + 0.001).toFixed(3)),
        toolCalls: mission.toolCalls + 1,
        twin: verifyTwin(mission.twin),
        events: [event("Outcome completed", ACTION_DETAILS[completed], "live", at), ...mission.events],
      };
    }

    const next = completed + 1;
    const waiting = next === 3;
    const approval = next === 4;
    return {
      ...mission,
      status: waiting ? "WAITING_EXTERNAL" : approval ? "NEEDS_APPROVAL" : "RUNNING",
      currentStep: next,
      steps: stepsAt(next, waiting || approval ? "waiting" : "active"),
      updatedAt: at,
      estimatedCost: Number((mission.estimatedCost + (completed > 0 ? 0.001 : 0)).toFixed(3)),
      toolCalls: mission.toolCalls + (completed > 0 ? 1 : 0),
      twin: completed === 0 ? activateTwin(mission.twin) : mission.twin,
      events: [event(`${mission.steps[completed].label} completed`, ACTION_DETAILS[completed], waiting ? "waiting" : approval ? "warning" : "live", at), ...mission.events],
    };
  }

  if (action.type === "external_reply") {
    if (mission.status !== "WAITING_EXTERNAL") return mission;
    const route = selectedRoute(mission.twin);
    return {
      ...mission,
      status: "NEEDS_APPROVAL",
      currentStep: 4,
      steps: stepsAt(4, "waiting"),
      updatedAt: at,
      events: [event("External reply received", `signal.external_reply · 200 OK · ${route.slot}`, "warning", at), ...mission.events],
    };
  }

  if (action.type === "external_reject") {
    if (mission.status !== "WAITING_EXTERNAL") return mission;
    const twin = fallbackTwin(mission.twin);
    const route = selectedRoute(twin);
    return {
      ...mission,
      status: "RUNNING",
      currentStep: 3,
      steps: stepsAt(3, "active"),
      updatedAt: at,
      estimatedCost: Number((mission.estimatedCost + .001).toFixed(3)),
      twin,
      artifacts: {
        ...mission.artifacts,
        externalReply: `Tuesday does not work; ${route.slot} works instead.`,
        calendarEvent: { ...mission.artifacts.calendarEvent, date: "Wed 19 Aug", time: "09:30–10:00" },
      },
      events: [event("A counter-proposed a protected fallback", `twin.fallback · ${route.id.toUpperCase()} · ${route.score}/100`, "live", at), event("Primary route rejected", "twin.invalidate · ROUTE_A · NO SECOND MESSAGE", "warning", at), ...mission.events],
    };
  }

  if (action.type === "approve") {
    if (mission.status !== "NEEDS_APPROVAL") return mission;
    return {
      ...mission,
      status: "RUNNING",
      currentStep: 5,
      steps: stepsAt(5, "active"),
      updatedAt: at,
      events: [event("Human boundary approved", "approval.resolve · APPROVED", "live", at), ...mission.events],
    };
  }

  if (action.type === "reject") {
    if (mission.status !== "NEEDS_APPROVAL") return mission;
    return {
      ...mission,
      status: "CANCELLED",
      steps: mission.steps.map((step, index) => index < 4 ? { ...step, state: "done" } : { ...step, state: "locked" }),
      updatedAt: at,
      events: [event("Human boundary declined", "approval.resolve · DECLINED · NO CHANGES", "warning", at), ...mission.events],
    };
  }

  return mission;
}
