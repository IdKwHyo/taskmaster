"use client";

import { Check, Clock3, LockKeyhole, MessageSquareMore, Sparkles } from "lucide-react";
import type { MissionStep, PrototypeMission } from "@/lib/henry-prototype";

const icons = { plan: Sparkles, calendar: Check, message: MessageSquareMore, wait: Clock3, approval: LockKeyhole, done: Check };

function edgeState(from: MissionStep, to: MissionStep) {
  if (from.state === "done" && to.state === "done") return "done";
  if (to.state === "active" || to.state === "waiting") return "active";
  return "pending";
}

const statusCopy = {
  RUNNING: "Henry is executing the next safe step",
  WAITING_EXTERNAL: "Suspended until an external reply arrives",
  NEEDS_APPROVAL: "Paused at a human approval boundary",
  COMPLETED: "Outcome completed",
  CANCELLED: "Stopped without making the final change",
  FAILED: "Stopped safely after a provider or guardrail failure",
} as const;

export default function MissionGraph({ mission }: { mission: PrototypeMission }) {
  const [plan, context, act, wait, approval, done] = mission.steps;
  const statusTone = mission.status === "RUNNING" || mission.status === "COMPLETED" ? "status-live" : "status-waiting";

  return (
    <div className="mission-graph">
      <div className="graph-status">
        <div className="flex items-center gap-2">
          <i className={`status-dot ${mission.paused ? "status-paused" : statusTone}`} />
          <span>{mission.paused ? "Paused safely" : statusCopy[mission.status]}</span>
        </div>
        <span className="font-mono text-[9px] text-[var(--faint)]">0 MODEL CALLS · 8 STEP CAP</span>
      </div>

      <div className="relative mx-auto hidden h-[278px] max-w-[820px] md:block">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 820 278" preserveAspectRatio="none" aria-hidden="true">
          <path className={`edge ${edgeState(plan, context)}`} d="M124 64 C185 64 183 64 240 64" />
          <path className={`edge ${edgeState(context, act)}`} d="M352 64 C407 64 411 64 468 64" />
          <path className={`edge ${edgeState(act, wait)}`} d="M580 64 C630 64 646 94 646 134" />
          <path className={`edge ${edgeState(wait, approval)}`} d="M646 188 C646 225 592 235 540 235" />
          <path className={`edge ${edgeState(approval, done)}`} d="M428 235 C370 235 346 235 294 235" />
        </svg>
        {mission.steps.map((step) => {
          const Icon = icons[step.icon];
          return (
            <div key={step.id} className={`mission-node ${step.state}`} style={{ left: step.x, top: step.y - 6 }}>
              <div className="node-icon"><Icon size={14} /></div>
              <div className="min-w-0">
                <div className="truncate text-[12px] font-medium">{step.label}</div>
                <div className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.04em] text-[var(--muted)]">
                  {step.state === "active" && mission.paused ? "paused" : step.state}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5 md:hidden">
        {mission.steps.map((step, index) => {
          const Icon = icons[step.icon];
          return (
            <div key={step.id} className={`mobile-step ${step.state}`}>
              <span className="font-mono text-[9px] text-[var(--faint)]">0{index + 1}</span>
              <Icon size={14} />
              <span>{step.label}</span>
              <span className="ml-auto font-mono text-[8px] uppercase text-[var(--muted)]">{step.state}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
