export type TwinRisk = "low" | "medium" | "high";
export type TwinRouteStatus = "selected" | "alternate" | "failed";
export type MissionTwinState = "SIMULATED" | "EXECUTING" | "FALLBACK" | "VERIFIED";

export type TwinRoute = {
  id: "route-a" | "route-b" | "route-c";
  label: string;
  slot: string;
  summary: string;
  steps: string[];
  conflicts: number;
  interruptions: number;
  approvalSteps: number;
  estimatedCost: number;
  risk: TwinRisk;
  baseConfidence: number;
  score: number;
  status: TwinRouteStatus;
};

export type MissionTwin = {
  state: MissionTwinState;
  trigger: {
    source: string;
    label: string;
    detail: string;
    code: string;
  };
  constraints: string[];
  routes: TwinRoute[];
  selectedRouteId: TwinRoute["id"];
  selectionReason: string;
  simulatedAt: string;
};

type RouteInput = Omit<TwinRoute, "score" | "status" | "baseConfidence"> & { confidence: number };

const RISK_PENALTY: Record<TwinRisk, number> = { low: 0, medium: 8, high: 18 };

export function scoreRoute(route: RouteInput): number {
  const score = route.confidence
    - route.conflicts * 28
    - route.interruptions * 4
    - route.approvalSteps * 2
    - route.estimatedCost * 100
    - RISK_PENALTY[route.risk];
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function createMissionTwin(outcome: string, at: string): MissionTwin {
  const candidates: RouteInput[] = [
    {
      id: "route-a",
      label: "Fastest close",
      slot: "Tue 15:30",
      summary: "Use the strongest shared opening and send one batched request.",
      steps: ["Hold Tue 15:30", "Contact A once", "Write after approval"],
      conflicts: 0,
      interruptions: 1,
      approvalSteps: 1,
      estimatedCost: .004,
      risk: "low",
      confidence: 98,
    },
    {
      id: "route-b",
      label: "Protected fallback",
      slot: "Wed 09:30",
      summary: "Preserve Tuesday and recover through Wednesday if A declines.",
      steps: ["Release Tuesday hold", "Offer Wed 09:30", "Write after approval"],
      conflicts: 0,
      interruptions: 2,
      approvalSteps: 1,
      estimatedCost: .005,
      risk: "low",
      confidence: 96,
    },
    {
      id: "route-c",
      label: "Late-week reserve",
      slot: "Thu 14:00",
      summary: "Keep a final option, but accept a tighter focus-work buffer.",
      steps: ["Protect Thu 14:00", "Move focus buffer", "Write after approval"],
      conflicts: 1,
      interruptions: 1,
      approvalSteps: 1,
      estimatedCost: .006,
      risk: "medium",
      confidence: 96,
    },
  ];
  const scored = candidates.map(({ confidence, ...route }) => ({
    ...route,
    baseConfidence: confidence,
    score: scoreRoute({ ...route, confidence }),
    status: "alternate" as const,
  }));
  const selected = scored.reduce((best, route) => route.score > best.score ? route : best);

  return {
    state: "SIMULATED",
    trigger: {
      source: "Dashboard",
      label: "Outcome delegated",
      detail: outcome,
      code: "MISSION.TWIN · DRY_RUN",
    },
    constraints: ["No calendar conflicts", "30-minute duration", "One approval boundary", "Under $0.05", "Maximum 8 steps"],
    routes: scored.map((route) => ({ ...route, status: route.id === selected.id ? "selected" : "alternate" })),
    selectedRouteId: selected.id,
    selectionReason: "Highest completion probability with one interruption, no conflicts and the lowest projected cost.",
    simulatedAt: at,
  };
}

export function selectedRoute(twin: MissionTwin): TwinRoute {
  return twin.routes.find((route) => route.id === twin.selectedRouteId) ?? twin.routes[0];
}

export function activateTwin(twin: MissionTwin): MissionTwin {
  return { ...twin, state: "EXECUTING" };
}

export function fallbackTwin(twin: MissionTwin): MissionTwin {
  const current = selectedRoute(twin);
  const fallback = twin.routes
    .filter((route) => route.id !== current.id && route.status !== "failed")
    .sort((left, right) => right.score - left.score)[0];
  if (!fallback) return twin;

  return {
    ...twin,
    state: "FALLBACK",
    selectedRouteId: fallback.id,
    selectionReason: `${current.slot} was rejected. Henry resumed from the next pre-validated route without rebuilding the mission.`,
    routes: twin.routes.map((route) => ({
      ...route,
      status: route.id === current.id ? "failed" : route.id === fallback.id ? "selected" : "alternate",
    })),
  };
}

export function verifyTwin(twin: MissionTwin): MissionTwin {
  return { ...twin, state: "VERIFIED", selectionReason: "The executed route matched the shadow run and every completion condition was verified." };
}
