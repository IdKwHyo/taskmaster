"use client";

import type { CSSProperties } from "react";

import {
  ArrowLeft,
  ArrowRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  CirclePause,
  CirclePlay,
  Clock3,
  GitBranch,
  MailCheck,
  MessageSquareReply,
  RotateCcw,
  Send,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import Strands from "@/components/Strands";
import type { PrototypeMission, PrototypeScenario } from "@/lib/henry-prototype";
import { selectedRoute } from "@/lib/mission-twin";

type Props = {
  mission: PrototypeMission;
  autoPlay: boolean;
  speed: number;
  canGoBack: boolean;
  busy: boolean;
  onOpenCalendar: () => void;
  onBack: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onReplay: () => void;
  onSpeedChange: (speed: number) => void;
  onScenario: (scenario: PrototypeScenario) => void;
};

const STEP_COPY = [
  { app: "Mission Twin", title: "Shadow-running 3 routes", detail: "Testing candidate workflows against live constraints before any external action.", code: "TWIN.SIMULATE" },
  { app: "Google Calendar", title: "Scanning availability", detail: "Comparing requested timing with existing commitments.", code: "CALENDAR.EVENTS.LIST" },
  { app: "Gmail", title: "Contacting A", detail: "Sending one concise message containing every valid option.", code: "GMAIL.MESSAGES.SEND" },
  { app: "Henry", title: "Waiting for A", detail: "The mission is suspended and will resume when a reply arrives.", code: "SIGNAL.WAIT" },
  { app: "Approval", title: "Your decision is required", detail: "The external calendar write is blocked until you authorize it.", code: "APPROVAL.BOUNDARY" },
  { app: "Google Calendar", title: "Creating the event", detail: "Writing the approved meeting to the selected calendar.", code: "CALENDAR.EVENTS.INSERT" },
];

function activeIndex(mission: PrototypeMission) {
  if (mission.status === "COMPLETED") return 5;
  return Math.min(mission.currentStep, 5);
}

function MissionTwinSurface({ mission }: { mission: PrototypeMission }) {
  const chosen = selectedRoute(mission.twin);
  const fallback = mission.twin.state === "FALLBACK";
  return (
    <div className="twin-surface app-surface">
      <div className="shadow-sweep" aria-hidden="true"><i /></div>
      <div className="twin-head">
        <div><span className="eyebrow"><GitBranch size={12} /> Mission Twin</span><h3>Henry is testing three ways forward.</h3><p>{mission.twin.selectionReason}</p></div>
        <div className="twin-summary"><strong>{mission.twin.routes.length}</strong><span>routes</span><b>{mission.twin.constraints.length} constraints</b></div>
      </div>
      <div className="twin-routes">
        {mission.twin.routes.map((route, index) => (
          <article key={route.id} tabIndex={0} aria-label={`${route.label}, score ${route.score} out of 100`} className={`twin-route ${route.status}`} style={{ "--route-delay": `${index * 90}ms` } as CSSProperties}>
            <div className="route-top"><span>{route.id.replace("route-", "Route ").toUpperCase()}</span><b>{route.status === "selected" ? "SELECTED" : route.status === "failed" ? "INVALIDATED" : "READY"}</b></div>
            <strong>{route.slot}</strong><h4>{route.label}</h4><p>{route.summary}</p>
            <div className="route-score"><span>FIT SCORE</span><strong>{route.score}</strong><small>/100</small></div>
            <div className="route-metrics"><span>{route.conflicts} conflicts</span><span>{route.interruptions} interrupt{route.interruptions === 1 ? "" : "s"}</span><span>${route.estimatedCost.toFixed(3)}</span></div>
            <div className="route-anatomy" aria-label="Score calculation">
              <div><span>Base confidence</span><b>{route.baseConfidence}</b></div>
              <div><span>Conflict penalty</span><b>−{route.conflicts * 28}</b></div>
              <div><span>Interruption penalty</span><b>−{route.interruptions * 4}</b></div>
              <div><span>Approval boundary</span><b>−{route.approvalSteps * 2}</b></div>
              <div><span>Cost + risk</span><b>−{Math.round(route.estimatedCost * 100) + (route.risk === "medium" ? 8 : route.risk === "high" ? 18 : 0)}</b></div>
              <div className="route-total"><span>Final fit</span><b>{route.score}/100</b></div>
            </div>
          </article>
        ))}
      </div>
      <div className={`reality-diff ${fallback ? "is-fallback" : ""}`}>
        <div><small>BEFORE · CURRENT REALITY</small><strong>Calendar unchanged</strong><span>3 openings · A not contacted</span></div>
        <ArrowRight size={14} />
        <div><small>{fallback ? "AFTER · RECOVERED PLAN" : "AFTER · SAFE PROPOSAL"}</small><strong>{chosen.slot} held in shadow</strong><span>{chosen.id.toUpperCase()} · approval required before write</span></div>
      </div>
      <div className="twin-foot"><span><ShieldAlert size={12} /> Shadow data only</span><code>{mission.twin.trigger.code} · {mission.twin.state}</code></div>
    </div>
  );
}

function CalendarSurface({ mission, onOpenCalendar }: { mission: PrototypeMission; onOpenCalendar: () => void }) {
  const scanning = mission.status === "RUNNING" && mission.currentStep === 1 && !mission.paused;
  const chosenSlot = selectedRoute(mission.twin).slot;
  return (
    <div className="calendar-surface app-surface">
      <div className="surface-appbar"><span><CalendarDays size={15} /> Google Calendar</span><b>{scanning ? "SCANNING" : "SCAN COMPLETE"}</b></div>
      <div className="mini-week">
        {["Mon", "Tue", "Wed", "Thu", "Fri"].map((day, index) => { const slot = ["", "Tue 15:30", "Wed 09:30", "Thu 14:00"][index]; return <div key={day}><strong>{day}</strong>{index === 1 ? <><span className="protected-block">Focus protected · 10–12</span><span className="busy-block">Product sync</span></> : null}{index === 2 ? <span className="busy-block later">Design review</span> : null}{index > 0 && index < 4 ? <i className={slot === chosenSlot ? "chosen" : ""}>{slot.replace(`${day} `, "")}</i> : null}</div>; })}
        {scanning ? <em className="mini-scan" /> : null}
      </div>
      <div className="calendar-impact"><div><small>BEFORE</small><strong>Tuesday focus preserved</strong></div><ArrowRight size={12} /><div><small>PROPOSED</small><strong>{chosenSlot} · 30 min</strong></div></div>
      <div className="surface-result"><Check size={13} /><span><strong>3 routes shadow-tested</strong><small>{chosenSlot} is the active path</small></span><button onClick={onOpenCalendar}>Inspect calendar</button></div>
    </div>
  );
}

function GmailSurface({ mission }: { mission: PrototypeMission }) {
  const hasReply = mission.currentStep >= 4 || ["NEEDS_APPROVAL", "COMPLETED"].includes(mission.status);
  const waiting = mission.status === "WAITING_EXTERNAL";
  return (
    <div className="gmail-surface app-surface">
      <div className="surface-appbar"><span><MailCheck size={15} /> Gmail</span><b>{waiting ? "SENT · WAITING" : hasReply ? "REPLY RECEIVED" : "COMPOSING"}</b></div>
      <div className="mail-fields"><div><span>To</span><strong>A</strong></div><div><span>Subject</span><strong>Project review availability</strong></div></div>
      <div className="mail-body">{mission.artifacts.outboundMessage.body}</div>
      <div className="mail-action"><span><Send size={12} /> {waiting || hasReply ? "Delivered with Gmail" : "Henry is preparing one batched request"}</span><b>{waiting || hasReply ? "202 ACCEPTED" : "DRAFT"}</b></div>
      {hasReply ? <div className="mail-reply"><MessageSquareReply size={14} /><span><strong>A replied</strong><p>{mission.artifacts.externalReply}</p></span></div> : null}
    </div>
  );
}

function WaitingSurface({ mission }: { mission: PrototypeMission }) {
  return <div className="waiting-surface app-surface"><Clock3 size={22} /><span className="eyebrow">Workflow suspended</span><h3>Waiting for A</h3><p>Henry will wake when Gmail receives a reply. Nothing is polling in the background.</p><div className="sleep-metrics"><div><span>Next trigger</span><strong>Gmail reply</strong></div><div><span>Active calls</span><strong>0</strong></div><div><span>Cost while waiting</span><strong>$0.000</strong></div></div><small>{mission.paused ? "MANUALLY PAUSED" : "SIGNAL.WAIT · ASLEEP"}</small></div>;
}

function ApprovalSurface({ mission }: { mission: PrototypeMission }) {
  return <div className="handoff-surface app-surface"><div className="handoff-mail"><MessageSquareReply size={14} /><span><strong>A accepted</strong><p>{mission.artifacts.externalReply}</p></span></div><div className="handoff-line"><i /></div><div className="proposed-calendar-card"><CalendarDays size={16} /><span><strong>{mission.outcome}</strong><p>{mission.artifacts.calendarEvent.date} · {mission.artifacts.calendarEvent.time}</p><small>PROPOSED · NOT WRITTEN</small></span></div><div className="handoff-boundary"><ShieldAlert size={14} /> Calendar write blocked until you approve</div></div>;
}

function CompletionSurface({ mission }: { mission: PrototypeMission }) {
  const complete = mission.status === "COMPLETED";
  const route = selectedRoute(mission.twin);
  return <div className="completion-surface app-surface"><div className={`completion-mark ${complete ? "done" : ""}`}>{complete ? <Check size={20} /> : <CalendarCheck2 size={20} />}</div><span className="eyebrow">Google Calendar</span><h3>{complete ? "Outcome verified" : "Creating approved event"}</h3><p>{mission.outcome}</p><div className="completed-event"><CalendarDays size={15} /><span><strong>{mission.artifacts.calendarEvent.date} · {mission.artifacts.calendarEvent.time}</strong><small>A invited · Primary calendar</small></span><b>{complete ? "200 OK" : "WRITING"}</b></div>{complete ? <div className="verification-ledger"><div className="verification-head"><span>SHADOW PREDICTION</span><ArrowRight size={12} /><span>ACTUAL RESULT</span><b><Check size={10} /> VERIFIED</b></div><div><span>{route.id.toUpperCase()} · {route.slot}</span><strong>{mission.artifacts.calendarEvent.date} · {mission.artifacts.calendarEvent.time}</strong></div><div><span>${route.estimatedCost.toFixed(3)} projected</span><strong>${mission.estimatedCost.toFixed(3)} actual</strong></div><div><span>{route.approvalSteps} approval boundary</span><strong>1 approval recorded</strong></div></div> : null}</div>;
}

function ShadowProof({ mission }: { mission: PrototypeMission }) {
  const route = selectedRoute(mission.twin);
  const failed = mission.twin.routes.find((item) => item.status === "failed");
  return <div className={`shadow-proof ${mission.twin.state.toLowerCase()} status-${mission.status.toLowerCase()}`}><GitBranch size={12} /><span><strong>{mission.twin.state === "FALLBACK" ? "Auto recovery" : "Shadow Run"}</strong>{failed ? `${failed.id.toUpperCase()} invalidated → ${route.id.toUpperCase()} active` : `${route.id.toUpperCase()} selected · ${route.score}/100`}</span><div className="shadow-route-strip" aria-label="Shadow route states">{mission.twin.routes.map((item) => <i key={item.id} className={item.status}>{item.id.slice(-1).toUpperCase()} <b>{item.status === "failed" ? "×" : item.score}</b></i>)}</div><i className="route-signal" aria-hidden="true" /><code>{mission.twin.state}</code></div>;
}

function FaultSurface({ mission }: { mission: PrototypeMission }) {
  return <div className="fault-surface app-surface"><TriangleAlert size={22} /><span className="eyebrow clay">Injected test condition</span><h3>{mission.simulation?.title}</h3><p>{mission.simulation?.detail}</p><div><strong>{mission.simulation?.code}</strong><span>Mission paused safely · use Replay or choose another scenario</span></div></div>;
}

export default function MissionPlayback(props: Props) {
  const { mission } = props;
  const index = activeIndex(mission);
  const copy = STEP_COPY[index];
  const waitingForDecision = mission.status === "NEEDS_APPROVAL";
  const speed = mission.status === "RUNNING" && !mission.paused ? .14 * props.speed : .025;

  return (
    <div className="mission-playback panel-enter">
      <aside className="playback-timeline" aria-label="Mission steps">
        <div className="timeline-label">Mission path</div>
        {mission.steps.map((step, stepIndex) => <div key={step.id} className={`timeline-step ${step.state} ${stepIndex === index ? "current" : ""}`}><i>{step.state === "done" ? <Check size={10} /> : stepIndex + 1}</i><span>{step.label}</span></div>)}
      </aside>

      <section className="playback-workspace">
        <div className="playback-context"><div><span>{copy.app}</span><strong>{mission.simulation ? mission.simulation.title : copy.title}</strong><p>{mission.simulation ? mission.simulation.detail : copy.detail}</p></div><code>{mission.simulation?.code ?? copy.code}</code></div>
        {index > 0 ? <ShadowProof mission={mission} /> : null}
        <div className={`playback-stage stage-${index}`}>
          <Strands speed={speed} opacity={mission.status === "RUNNING" ? .14 : .075} amplitude={mission.status === "RUNNING" ? .72 : .45} />
          <div className="stage-content">
            {mission.simulation ? <FaultSurface mission={mission} /> : index === 0 ? <MissionTwinSurface mission={mission} /> : index === 1 ? <CalendarSurface mission={mission} onOpenCalendar={props.onOpenCalendar} /> : index === 2 ? <GmailSurface mission={mission} /> : index === 3 ? <WaitingSurface mission={mission} /> : index === 4 ? <ApprovalSurface mission={mission} /> : <CompletionSurface mission={mission} />}
          </div>
        </div>

        <div className="playback-controls">
          <span className="test-mode-label">Test mode</span>
          <button className="control-button pressable" disabled={!props.canGoBack || props.busy} onClick={props.onBack} aria-label="Previous workflow step"><ArrowLeft size={13} /></button>
          <button className="control-button primary pressable" disabled={waitingForDecision || mission.status === "WAITING_EXTERNAL" || props.busy || mission.status === "COMPLETED" || mission.status === "CANCELLED" || Boolean(mission.simulation)} onClick={props.onTogglePlay}>{props.autoPlay ? <CirclePause size={14} /> : <CirclePlay size={14} />} {mission.status === "WAITING_EXTERNAL" ? "Waiting" : props.autoPlay ? "Pause" : "Play"}</button>
          <button className="control-button pressable" disabled={waitingForDecision || props.busy || mission.status === "COMPLETED" || mission.status === "CANCELLED" || Boolean(mission.simulation)} onClick={props.onNext}>Next <ArrowRight size={13} /></button>
          <button className="control-button pressable" onClick={props.onReplay}><RotateCcw size={12} /> Restart</button>
          <label className="control-select">Speed<select value={props.speed} onChange={(event) => props.onSpeedChange(Number(event.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label>
          <label className="control-select scenario-select">Scenario<select defaultValue="" onChange={(event) => { if (event.target.value) props.onScenario(event.target.value as PrototypeScenario); event.target.value = ""; }}><option value="" disabled>Choose state…</option><option value="standard">Fresh Shadow Run</option><option value="route_fallback">Route A rejected</option><option value="waiting_reply">Waiting for reply</option><option value="approval_needed">Approval needed</option><option value="calendar_failure">Calendar failure</option><option value="gmail_failure">Gmail failure</option><option value="budget_limit">Budget limit</option></select></label>
        </div>
        {waitingForDecision ? <div className="playback-notice"><ShieldAlert size={13} /> Playback stopped at the human boundary. Use the approval panel beside the stage.</div> : null}
      </section>
    </div>
  );
}
