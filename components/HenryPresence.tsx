"use client";

import { Check, Clock3, GitBranch, ShieldAlert, Volume2 } from "lucide-react";
import type { PrototypeMission } from "@/lib/henry-prototype";
import { selectedRoute } from "@/lib/mission-twin";

type PresenceState = {
  className: string;
  label: string;
  headline: string;
  detail: string;
  icon: typeof GitBranch;
};

function presenceFor(mission: PrototypeMission, speaking: boolean): PresenceState {
  if (speaking) return { className: "speaking", label: "Speaking", headline: "Briefing you now", detail: "Voice follows the current mission state.", icon: Volume2 };
  if (mission.paused) return { className: "paused", label: "Paused safely", headline: "Execution is suspended", detail: "Checkpoint preserved. No new calls are running.", icon: ShieldAlert };
  if (mission.status === "NEEDS_APPROVAL") return { className: "approval", label: "Human boundary", headline: "Your judgment is required", detail: "The proposed action is outside delegated authority.", icon: ShieldAlert };
  if (mission.status === "WAITING_EXTERNAL") return { className: "waiting", label: "Sleeping", headline: "Waiting without polling", detail: "Henry will resume when the external signal arrives.", icon: Clock3 };
  if (mission.status === "COMPLETED") return { className: "complete", label: "Verified", headline: "Outcome protected", detail: "The final state matches the completion contract.", icon: Check };
  if (mission.status === "CANCELLED") return { className: "cancelled", label: "Stopped", headline: "No changes committed", detail: "The boundary was declined and the mission ended safely.", icon: ShieldAlert };
  if (mission.status === "FAILED") return { className: "cancelled", label: "Protected stop", headline: "Execution halted safely", detail: "Evidence and checkpoint state were preserved for inspection.", icon: ShieldAlert };
  if (mission.twin.state === "FALLBACK") return { className: "recovery", label: "Recovering", headline: "Re-routing around change", detail: "The next pre-validated route is now active.", icon: GitBranch };
  if (mission.currentStep === 0) return { className: "planning", label: "Planning", headline: "Shadow-running routes", detail: "Testing the outcome against constraints before acting.", icon: GitBranch };
  return { className: "running", label: "Executing", headline: "Working inside authority", detail: "The active route remains within the delegated envelope.", icon: GitBranch };
}

export default function HenryPresence({ mission, speaking }: { mission: PrototypeMission; speaking: boolean }) {
  const presence = presenceFor(mission, speaking);
  const route = selectedRoute(mission.twin);
  const Icon = presence.icon;

  return (
    <aside className={`henry-presence state-${presence.className}`} aria-label={`Henry status: ${presence.label}`}>
      <div className="presence-visual" aria-hidden="true">
        <i className="presence-orbit orbit-one" />
        <i className="presence-orbit orbit-two" />
        <i className="presence-orbit orbit-three" />
        <span className="presence-axis axis-one" />
        <span className="presence-axis axis-two" />
        <b className="presence-nucleus"><Icon size={15} /></b>
      </div>
      <div className="presence-copy">
        <span className="presence-label"><i /> HENRY · {presence.label.toUpperCase()}</span>
        <strong>{presence.headline}</strong>
        <p>{presence.detail}</p>
        <div className="presence-evidence">
          <span>{route.id.toUpperCase()} · {route.score}/100</span>
          <span>STEP {mission.status === "COMPLETED" ? 6 : mission.currentStep + 1}/6</span>
          <span>${mission.estimatedCost.toFixed(3)}</span>
        </div>
      </div>
    </aside>
  );
}
