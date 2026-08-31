"use client";

import { CalendarDays, Check, Clock3, Download, ShieldCheck, X } from "lucide-react";
import type { PrototypeMission } from "@/lib/henry-prototype";

type Action = "external_reply" | "external_reject" | "approve" | "reject";

export default function ApprovalCard({ mission, busy, onAction }: { mission: PrototypeMission; busy: boolean; onAction: (action: Action) => void }) {
  const inviteUrl = `/api/invite?title=${encodeURIComponent(mission.artifacts.calendarEvent.title)}&id=${encodeURIComponent(mission.artifacts.calendarEvent.eventId)}`;

  if (mission.status === "WAITING_EXTERNAL") {
    return (
      <article id="approvals" className="approval-material scroll-mt-20">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow clay"><Clock3 size={12} /> Next event</span>
          <span className="boundary-state">Waiting</span>
        </div>
        <h2 className="mt-4 text-[18px] font-semibold tracking-[-0.02em]">Henry is waiting on A</h2>
        <p className="mt-1.5 text-[12px] leading-5 text-[var(--muted)]">Nothing is required from you. For the demo, trigger the reply that wakes this mission.</p>
        <div className="simulate-choice">
          <button disabled={busy} onClick={() => onAction("external_reply")} className="simulate-action pressable"><span>A accepts</span><span className="font-mono text-[9px]">ACTIVE ROUTE</span></button>
          <button disabled={busy} onClick={() => onAction("external_reject")} className="simulate-action secondary pressable"><span>A rejects</span><span className="font-mono text-[9px]">TEST FALLBACK</span></button>
        </div>
      </article>
    );
  }

  if (mission.status === "NEEDS_APPROVAL") {
    return (
      <article id="approvals" className="approval-material scroll-mt-20">
        <div className="flex items-center justify-between gap-3">
          <span className="eyebrow clay"><ShieldCheck size={12} /> Human boundary</span>
          <span className="boundary-state">Approval needed</span>
        </div>
        <h2 className="mt-4 text-[18px] font-semibold tracking-[-0.02em]">Authorize the final action?</h2>
        <p className="mt-1.5 text-[12px] leading-5 text-[var(--muted)]">Henry prepared the calendar change but has not committed it.</p>
        <div className="calendar-preview">
          <div className="calendar-icon"><CalendarDays size={16} /></div>
          <div>
            <div className="text-[13px] font-medium">{mission.outcome}</div>
            <div className="mt-1 text-[11px] text-[var(--muted)]">{mission.artifacts.calendarEvent.date} · {mission.artifacts.calendarEvent.time}</div>
            <div className="mt-1 font-mono text-[9px] text-[var(--faint)]">PROPOSED · NOTHING WRITTEN YET</div>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button disabled={busy} onClick={() => onAction("reject")} className="secondary-action pressable"><X size={14} /> Decline</button>
          <button disabled={busy} onClick={() => onAction("approve")} className="approve-action pressable"><Check size={14} /> Approve</button>
        </div>
      </article>
    );
  }

  const completed = mission.status === "COMPLETED";
  const cancelled = mission.status === "CANCELLED";
  return (
    <article id="approvals" className="approval-material scroll-mt-20">
      <div className="flex items-center justify-between gap-3">
        <span className="eyebrow"><ShieldCheck size={12} /> Needs you</span>
        <span className={`boundary-state ${completed ? "approved" : cancelled ? "rejected" : ""}`}>
          {completed ? "Resolved" : cancelled ? "Declined" : "Clear"}
        </span>
      </div>
      <div className={`decision-result ${cancelled ? "rejected" : ""}`}>
        {cancelled ? <X size={18} /> : <Check size={18} />}
        <div>
          <div className="text-[13px] font-medium">{completed ? "Nothing needs your attention" : cancelled ? "No final changes were made" : "No decision is required"}</div>
          <div className="mt-1 text-[11px] opacity-75">{completed ? "The approved meeting is ready to add to any calendar." : cancelled ? "The workflow stopped safely." : "Henry is still inside its safe execution boundary."}</div>
          {completed ? <a className="decision-download pressable" href={inviteUrl}><Download size={12} /> Download calendar invite</a> : null}
        </div>
      </div>
    </article>
  );
}
