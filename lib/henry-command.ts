import { runPrototypeAction, type MissionStatus, type PrototypeMission } from "./henry-prototype.ts";

export type HenryCommandIntent =
  | "day_plan"
  | "briefing"
  | "explain"
  | "approve"
  | "decline"
  | "pause"
  | "resume"
  | "external_accept"
  | "external_reject"
  | "inspect_calendar"
  | "inspect_cost"
  | "unknown";

export type HenryCommandSurface = "mission" | "approval" | "calendar" | "cost" | "none";

export type HenryCommandFact = {
  label: string;
  value: string;
  detail: string;
  surface: HenryCommandSurface;
};

export type HenryCommandResponse = {
  id: string;
  intent: HenryCommandIntent;
  headline: string;
  summary: string;
  recommendation: string;
  facts: HenryCommandFact[];
  surface: HenryCommandSurface;
  changedMission: boolean;
  sourceEventIds: string[];
  speech: string;
  agenda?: {
    dateLabel: string;
    focusWindow: string;
    items: Array<{ id: string; time: string; title: string; endTime: string }>;
  };
};

export type HenryCommandResult = {
  mission: PrototypeMission;
  response: HenryCommandResponse;
};

const STATUS_COPY: Record<MissionStatus, { headline: string; summary: string; recommendation: string; surface: HenryCommandSurface }> = {
  RUNNING: {
    headline: "Henry is working without you.",
    summary: "The active route is inside its approved boundaries. No judgment is required yet.",
    recommendation: "Let the mission continue. Henry will stop before any externally visible write.",
    surface: "mission",
  },
  WAITING_EXTERNAL: {
    headline: "The mission is asleep until A replies.",
    summary: "Henry has suspended execution instead of polling. Waiting currently costs $0.000.",
    recommendation: "No action is needed. You can inject an acceptance or rejection to test the wake-up path.",
    surface: "mission",
  },
  NEEDS_APPROVAL: {
    headline: "One decision needs you.",
    summary: "Henry prepared the final calendar change, but the external write remains blocked.",
    recommendation: "Review the proposed slot and approve only if the evidence matches your intent.",
    surface: "approval",
  },
  COMPLETED: {
    headline: "The outcome is complete and verified.",
    summary: "Henry read the result back and matched it against the selected shadow route.",
    recommendation: "Nothing needs your attention. The evidence remains available in the mission record.",
    surface: "mission",
  },
  CANCELLED: {
    headline: "The mission stopped safely.",
    summary: "The human boundary was declined, so Henry made no final external change.",
    recommendation: "Restart the mission only if you want Henry to prepare a new route.",
    surface: "mission",
  },
  FAILED: {
    headline: "Henry stopped before causing damage.",
    summary: "A provider or guardrail failure halted execution and preserved the mission record.",
    recommendation: "Inspect the latest event, then retry only after the failure is understood.",
    surface: "mission",
  },
};

function normalize(query: string) {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

export function classifyHenryCommand(query: string): HenryCommandIntent {
  const value = normalize(query);
  if (/what.?s on my day|what is on my day|my day|today.?s schedule|schedule today|agenda/.test(value)) return "day_plan";
  if (!value || /brief|attention|today|plate|update|changed|status|morning/.test(value)) return "briefing";
  if (/\bwhy\b|explain|what happened|what are you doing/.test(value)) return "explain";
  if (/show|open|inspect/.test(value) && /calendar|schedule/.test(value)) return "inspect_calendar";
  if (/show|open|inspect|how much/.test(value) && /cost|budget|spend|price/.test(value)) return "inspect_cost";
  if (/\bapprove\b|go ahead|do it|looks good/.test(value)) return "approve";
  if (/\bdecline\b|cancel|stop final|don.t do it/.test(value)) return "decline";
  if (/\bpause\b|hold the mission|stop working/.test(value)) return "pause";
  if (/\bresume\b|continue|keep going/.test(value)) return "resume";
  if (/(a|they).*(accepted|accepts|said yes|works)|simulate accept/.test(value)) return "external_accept";
  if (/(a|they).*(rejected|rejects|said no|can.t make)|simulate reject/.test(value)) return "external_reject";
  return "unknown";
}

function factsFor(mission: PrototypeMission): HenryCommandFact[] {
  const status = mission.paused ? "PAUSED" : mission.status.replaceAll("_", " ");
  const latest = mission.events[0];
  return [
    { label: "STATE", value: status, detail: `Step ${mission.status === "COMPLETED" ? 6 : mission.currentStep + 1} of 6`, surface: "mission" },
    { label: "LATEST CHANGE", value: latest.title, detail: latest.time, surface: "mission" },
    { label: "MISSION COST", value: `$${mission.estimatedCost.toFixed(3)}`, detail: `${mission.toolCalls} tool calls · ${mission.modelCalls} model calls`, surface: "cost" },
  ];
}

function responseFor(mission: PrototypeMission, intent: HenryCommandIntent, overrides: Partial<HenryCommandResponse> = {}): HenryCommandResponse {
  const copy = STATUS_COPY[mission.status];
  return {
    id: `cmd-${mission.updatedAt}-${intent}`,
    intent,
    headline: copy.headline,
    summary: copy.summary,
    recommendation: copy.recommendation,
    facts: factsFor(mission),
    surface: copy.surface,
    changedMission: false,
    sourceEventIds: mission.events.slice(0, 3).map((item) => item.id),
    speech: `${copy.headline} ${copy.summary} ${copy.recommendation}`,
    ...overrides,
  };
}

export function buildDailyBriefing(mission: PrototypeMission): HenryCommandResponse {
  const dateLabel = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Bangkok" }).format(new Date()).toUpperCase();
  const approvalLine = mission.status === "NEEDS_APPROVAL"
    ? "One prepared calendar change needs your approval."
    : mission.status === "WAITING_EXTERNAL"
      ? "The project review is waiting on A, so nothing is required from you."
      : "Henry is managing the active mission in the background.";
  const items = [
    { id: "day-standup", time: "09:30", title: "Team stand-up", endTime: "10:00" },
    { id: "day-product", time: "11:00", title: "Product review", endTime: "11:45" },
    { id: "day-client", time: "14:00", title: "Client call", endTime: "15:00" },
  ];
  const summary = `Team stand-up is at 09:30, product review at 11:00, and your client call at 14:00. ${approvalLine}`;
  const recommendation = mission.status === "NEEDS_APPROVAL"
    ? "Protect 11:45–14:00 for focused work, then review Henry's pending calendar change."
    : "Protect 11:45–14:00 for focused work. Henry will surface anything that changes.";
  return responseFor(mission, "day_plan", {
    headline: "You have three commitments today.",
    summary,
    recommendation,
    surface: "none",
    facts: [
      { label: "CALENDAR", value: "3 commitments", detail: "09:30–15:00 · demo data", surface: "calendar" },
      { label: "FOCUS WINDOW", value: "11:45–14:00", detail: "2h 15m protected", surface: "calendar" },
      { label: "HENRY", value: mission.status === "NEEDS_APPROVAL" ? "1 decision" : "No action needed", detail: mission.status.replaceAll("_", " "), surface: mission.status === "NEEDS_APPROVAL" ? "approval" : "mission" },
    ],
    agenda: { dateLabel: `TODAY · ${dateLabel}`, focusWindow: "11:45–14:00", items },
    speech: `You have three commitments today. Team stand-up at nine thirty, product review at eleven, and a client call at two. Your longest focus window is from eleven forty-five to two. ${approvalLine}`,
  });
}

export function briefMission(mission: PrototypeMission): HenryCommandResponse {
  return responseFor(mission, "briefing");
}

export function runHenryCommand(query: string, mission: PrototypeMission): HenryCommandResult {
  const intent = classifyHenryCommand(query);
  if (intent === "day_plan") return { mission, response: buildDailyBriefing(mission) };
  if (intent === "briefing") return { mission, response: briefMission(mission) };

  if (intent === "explain") {
    const latest = mission.events[0];
    return {
      mission,
      response: responseFor(mission, intent, {
        headline: latest.title,
        summary: `${latest.detail}. This event moved Henry into ${mission.status.replaceAll("_", " ").toLowerCase()}.`,
        recommendation: STATUS_COPY[mission.status].recommendation,
      }),
    };
  }

  if (intent === "inspect_calendar") {
    return { mission, response: responseFor(mission, intent, { headline: "Opening the calendar evidence.", summary: "This window shows the commitments and candidate slots Henry used to choose its route.", recommendation: "Inspect the selected slot and its conflicts.", surface: "calendar" }) };
  }

  if (intent === "inspect_cost") {
    return { mission, response: responseFor(mission, intent, { headline: `This mission has used $${mission.estimatedCost.toFixed(3)}.`, summary: `${mission.toolCalls} tool calls and ${mission.modelCalls} model calls are recorded by the mission engine.`, recommendation: "The mission remains inside its $0.020 prototype budget.", surface: "cost" }) };
  }

  const action = intent === "approve" ? "approve"
    : intent === "decline" ? "reject"
      : intent === "external_accept" ? "external_reply"
        : intent === "external_reject" ? "external_reject"
          : intent === "pause" || intent === "resume" ? "toggle_pause"
            : null;

  const allowed = action === "approve" || action === "reject" ? mission.status === "NEEDS_APPROVAL"
    : action === "external_reply" || action === "external_reject" ? mission.status === "WAITING_EXTERNAL"
      : action === "toggle_pause" ? ["RUNNING", "WAITING_EXTERNAL"].includes(mission.status) && ((intent === "pause" && !mission.paused) || (intent === "resume" && mission.paused))
        : false;

  if (action && allowed) {
    const nextMission = runPrototypeAction({ type: action, mission });
    return {
      mission: nextMission,
      response: responseFor(nextMission, intent, {
        headline: nextMission.events[0].title,
        summary: nextMission.events[0].detail,
        recommendation: STATUS_COPY[nextMission.status].recommendation,
        changedMission: true,
      }),
    };
  }

  const guardMessage = action
    ? `That command is safe, but it does not apply while the mission is ${mission.status.replaceAll("_", " ").toLowerCase()}${mission.paused ? " and paused" : ""}.`
    : "I can brief you, explain the current state, inspect cost or calendar evidence, pause work, simulate A's reply, and resolve approvals.";
  return {
    mission,
    response: responseFor(mission, "unknown", {
      headline: action ? "No state change was made." : "I understood this as a question, not a new outcome.",
      summary: guardMessage,
      recommendation: "To start new work, switch to Delegate outcome.",
      surface: "none",
    }),
  };
}
