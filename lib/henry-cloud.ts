import { createMission, type MissionEvent, type MissionStep, type PrototypeAction, type PrototypeMission } from "./henry-prototype.ts";

type CloudStep = {
  id: string;
  name: string;
  kind: "PLAN" | "CHECK_CALENDAR" | "CONTACT_ATTENDEE" | "WAIT_EXTERNAL" | "APPROVAL" | "BOOK_AND_CONFIRM";
  status: "PENDING" | "RUNNING" | "WAITING" | "COMPLETED" | "FAILED" | "SKIPPED";
  output: Record<string, unknown>;
  last_error?: string | null;
};

type CloudMission = {
  id: string;
  outcome: string;
  status: string;
  current_step_index: number;
  created_at: string;
  updated_at: string;
  usage: {
    model_calls: number;
    tool_calls: number;
    estimated_model_cost_usd: number;
  };
  authority: {
    allowed_actions: string[];
    approval_required_for: string[];
    forbidden_actions: string[];
    spend_limit_usd: number;
    completion_contract: string[];
  };
  steps: CloudStep[];
};

type CloudEvent = {
  id: string;
  event_type: string;
  message: string;
  created_at: string;
  data?: Record<string, unknown>;
};

type CloudApproval = { id: string; mission_id: string; status: string };

export type HenryCloudConfig = {
  baseUrl: string;
  apiKey?: string;
  ownerId?: string;
  fetcher?: typeof fetch;
};

const STEP_META: Array<Pick<MissionStep, "id" | "label" | "icon" | "x" | "y"> & { kind: CloudStep["kind"] }> = [
  { id: "plan", kind: "PLAN", label: "Plan outcome", icon: "plan", x: 16, y: 38 },
  { id: "context", kind: "CHECK_CALENDAR", label: "Check context", icon: "calendar", x: 240, y: 38 },
  { id: "act", kind: "CONTACT_ATTENDEE", label: "Contact dependency", icon: "message", x: 468, y: 38 },
  { id: "wait", kind: "WAIT_EXTERNAL", label: "Await response", icon: "wait", x: 590, y: 142 },
  { id: "approval", kind: "APPROVAL", label: "Human approval", icon: "approval", x: 428, y: 214 },
  { id: "done", kind: "BOOK_AND_CONFIRM", label: "Verify outcome", icon: "done", x: 182, y: 214 },
];

function headers(config: HenryCloudConfig, write = false) {
  const result: Record<string, string> = { "Content-Type": "application/json" };
  if (write && config.apiKey) result.Authorization = `Bearer ${config.apiKey}`;
  return result;
}

async function request<T>(config: HenryCloudConfig, path: string, init?: RequestInit): Promise<T> {
  const fetcher = config.fetcher ?? fetch;
  const response = await fetcher(`${config.baseUrl.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { ...headers(config, init?.method !== undefined && init.method !== "GET"), ...init?.headers },
    signal: AbortSignal.timeout(8_000),
  });
  const payload = await response.json() as T & { detail?: string };
  if (!response.ok) throw new Error(payload.detail ?? `Henry Cloud returned ${response.status}`);
  return payload;
}

function stepState(step: CloudStep | undefined, mission: CloudMission): MissionStep["state"] {
  if (!step) return "locked";
  if (step.status === "COMPLETED") return "done";
  if (step.status === "WAITING") return "waiting";
  if (step.status === "RUNNING") return "active";
  if (step.status === "FAILED") return "waiting";
  if (mission.steps.indexOf(step) === mission.current_step_index) return "active";
  return "locked";
}

function eventTone(type: string): MissionEvent["tone"] {
  if (type.includes("FAILED") || type.includes("PAUSED") || type.includes("APPROVAL")) return "warning";
  if (type.includes("WAIT")) return "waiting";
  if (type.includes("COMPLETED") || type.includes("RESUMED") || type.includes("RECEIVED")) return "live";
  return "neutral";
}

function eventTime(value: string) {
  return `${value.slice(11, 23)} UTC`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function cloudStatus(status: string): PrototypeMission["status"] {
  if (status === "WAITING_EXTERNAL") return "WAITING_EXTERNAL";
  if (status === "WAITING_APPROVAL") return "NEEDS_APPROVAL";
  if (status === "COMPLETED") return "COMPLETED";
  if (status === "CANCELLED") return "CANCELLED";
  return "RUNNING";
}

export function mapCloudMission(mission: CloudMission, events: CloudEvent[] = []): PrototypeMission {
  const base = createMission(mission.outcome, mission.id, mission.created_at);
  const byKind = new Map(mission.steps.map((step) => [step.kind, step]));
  const calendarOutput = byKind.get("CHECK_CALENDAR")?.output ?? {};
  const contactOutput = byKind.get("CONTACT_ATTENDEE")?.output ?? {};
  const waitOutput = byKind.get("WAIT_EXTERNAL")?.output ?? {};
  const bookingOutput = byKind.get("BOOK_AND_CONFIRM")?.output ?? {};
  const availableSlots = stringArray(calendarOutput.available_slots);
  const selectedSlot = typeof waitOutput.selected_slot === "string" ? waitOutput.selected_slot : availableSlots[0];
  const paused = mission.status === "PAUSED" || mission.status === "PAUSED_BUDGET" || mission.status === "FAILED";
  const currentStep = Math.min(Math.max(mission.current_step_index, 0), 5);
  const mappedEvents = events.map((item) => ({
    id: item.id,
    title: item.message,
    time: eventTime(item.created_at),
    detail: item.event_type,
    tone: eventTone(item.event_type),
  }));

  return {
    ...base,
    backend: "cloud",
    engineStatus: mission.status,
    status: cloudStatus(mission.status),
    currentStep,
    paused,
    updatedAt: mission.updated_at,
    estimatedCost: mission.usage.estimated_model_cost_usd,
    modelCalls: mission.usage.model_calls,
    toolCalls: mission.usage.tool_calls,
    steps: STEP_META.map((meta) => {
      const cloudStep = byKind.get(meta.kind);
      return { ...meta, state: stepState(cloudStep, mission), label: cloudStep?.name ?? meta.label };
    }),
    events: mappedEvents.length ? mappedEvents : base.events,
    artifacts: {
      ...base.artifacts,
      calendarScan: {
        ...base.artifacts.calendarScan,
        calendarsChecked: availableSlots.length ? 2 : 0,
        freeSlots: availableSlots.length ? availableSlots : base.artifacts.calendarScan.freeSlots,
      },
      outboundMessage: {
        recipient: typeof contactOutput.recipient === "string" ? contactOutput.recipient : "A",
        body: typeof contactOutput.body === "string" ? contactOutput.body : base.artifacts.outboundMessage.body,
      },
      externalReply: typeof waitOutput.reply === "string" ? waitOutput.reply : base.artifacts.externalReply,
      calendarEvent: {
        ...base.artifacts.calendarEvent,
        date: selectedSlot ? new Date(selectedSlot).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Bangkok" }) : base.artifacts.calendarEvent.date,
        time: selectedSlot ? `${new Date(selectedSlot).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Bangkok" })}–30 min` : base.artifacts.calendarEvent.time,
        eventId: typeof bookingOutput.calendar_event_id === "string" ? bookingOutput.calendar_event_id : base.artifacts.calendarEvent.eventId,
      },
    },
    authority: {
      allowedActions: mission.authority.allowed_actions,
      approvalRequiredFor: mission.authority.approval_required_for,
      forbiddenActions: mission.authority.forbidden_actions,
      spendLimitUsd: mission.authority.spend_limit_usd,
      completionContract: mission.authority.completion_contract,
    },
    simulation: mission.status === "PAUSED_BUDGET"
      ? { kind: "budget_limit", title: "Mission budget reached", detail: "The durable engine stopped before another paid action began.", code: "BUDGET.GUARD · PAUSED" }
      : mission.status === "FAILED"
        ? { kind: "calendar_failure", title: "Mission execution stopped", detail: "The durable engine exhausted its bounded retries. Inspect Activity for evidence.", code: "WORKFLOW · FAILED" }
        : undefined,
  };
}

async function hydrate(config: HenryCloudConfig, mission: CloudMission) {
  const response = await request<{ events: CloudEvent[] }>(config, `/api/v1/missions/${mission.id}/events`);
  return mapCloudMission(mission, response.events);
}

async function pendingApproval(config: HenryCloudConfig, missionId: string) {
  const response = await request<{ approvals: CloudApproval[] }>(config, "/api/v1/approvals?status=PENDING");
  return response.approvals.find((approval) => approval.mission_id === missionId);
}

export async function runCloudAction(config: HenryCloudConfig, action: PrototypeAction): Promise<PrototypeMission> {
  if (action.type === "create") {
    const mission = await request<CloudMission>(config, "/api/v1/missions", {
      method: "POST",
      body: JSON.stringify({ outcome: action.outcome, owner_id: config.ownerId ?? "dashboard-owner" }),
    });
    return hydrate(config, mission);
  }
  if (action.type === "command" || action.type === "scenario") throw new Error("This action remains local to the interactive lab.");
  if (action.mission.backend !== "cloud") throw new Error("Mission is not owned by Henry Cloud.");

  let mission: CloudMission;
  if (action.type === "advance") {
    mission = await request<CloudMission>(config, `/api/v1/missions/${action.mission.id}`);
  } else if (action.type === "external_reply" || action.type === "external_reject") {
    const slots = action.mission.artifacts.calendarScan.freeSlots;
    mission = await request<CloudMission>(config, `/api/v1/missions/${action.mission.id}/external-events`, {
      method: "POST",
      body: JSON.stringify({
        event_id: `dashboard-${crypto.randomUUID()}`,
        payload: {
          attendee: "A",
          selected_slot: action.type === "external_reject" ? slots[1] ?? slots[0] : slots[0],
          reply: action.type === "external_reject" ? "Tuesday does not work; Wednesday is available." : "The first option works for me.",
        },
      }),
    });
  } else if (action.type === "approve" || action.type === "reject") {
    const approval = await pendingApproval(config, action.mission.id);
    if (!approval) throw new Error("No pending approval was found for this mission.");
    mission = await request<CloudMission>(config, `/api/v1/approvals/${approval.id}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision: action.type, decided_by: config.ownerId ?? "dashboard-owner" }),
    });
  } else {
    mission = await request<CloudMission>(config, `/api/v1/missions/${action.mission.id}/control`, {
      method: "POST",
      body: JSON.stringify({ action: action.mission.paused ? "resume" : "pause" }),
    });
  }
  return hydrate(config, mission);
}
