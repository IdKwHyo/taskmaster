"use client";

import { CalendarCheck2, CalendarSearch, Download, ExternalLink, MailCheck, MessageSquareReply } from "lucide-react";
import type { PrototypeMission } from "@/lib/henry-prototype";

function outputState(mission: PrototypeMission, availableAt: number) {
  if (mission.status === "CANCELLED" && availableAt >= 5) return "BLOCKED";
  return mission.currentStep >= availableAt || mission.status === "COMPLETED" ? "READY" : "PENDING";
}

export default function WorkProduct({ mission, embedded = false, onOpenCalendar }: { mission: PrototypeMission; embedded?: boolean; onOpenCalendar?: () => void }) {
  const calendarReady = outputState(mission, 2) === "READY";
  const messageReady = outputState(mission, 3) === "READY";
  const replyReady = outputState(mission, 4) === "READY";
  const eventCreated = mission.status === "COMPLETED";
  const eventProposed = mission.status === "NEEDS_APPROVAL" || mission.currentStep >= 5;
  const inviteUrl = `/api/invite?title=${encodeURIComponent(mission.artifacts.calendarEvent.title)}&id=${encodeURIComponent(mission.artifacts.calendarEvent.eventId)}`;

  return (
    <article className={embedded ? "work-product is-embedded" : "secondary-material work-product"}>
      <div className="section-heading">
        <div><span className="eyebrow"><CalendarCheck2 size={12} /> Work product</span><h2>What Henry changed</h2></div>
        <span className="font-mono text-[9px] text-[var(--faint)]">VISIBLE OUTPUT</span>
      </div>

      <div className="output-ledger">
        <section className={`output-row ${calendarReady ? "is-ready" : ""}`}>
          <div className="output-icon"><CalendarSearch size={15} /></div>
          <div className="min-w-0 flex-1">
            <div className="output-heading"><strong>Calendar scan</strong><span>{calendarReady ? "3 SLOTS FOUND" : "PENDING"}</span></div>
            {calendarReady ? (
              <><p>Checked {mission.artifacts.calendarScan.calendarsChecked} calendars around existing commitments.</p><div className="slot-line">{mission.artifacts.calendarScan.freeSlots.map((slot, index) => <span key={slot} className={index === 0 ? "selected" : ""}>{slot}</span>)}</div>{onOpenCalendar ? <button className="inspect-calendar pressable" onClick={onOpenCalendar}><ExternalLink size={11} /> Inspect Google Calendar</button> : null}</>
            ) : <p>Henry will inspect the demo calendar after planning.</p>}
          </div>
        </section>

        <section className={`output-row ${messageReady ? "is-ready" : ""}`}>
          <div className="output-icon"><MailCheck size={15} /></div>
          <div className="min-w-0 flex-1">
            <div className="output-heading"><strong>Message to A</strong><span>{messageReady ? "GMAIL · SENT" : "PENDING"}</span></div>
            <p className={messageReady ? "message-copy" : ""}>{messageReady ? mission.artifacts.outboundMessage.body : "Waiting for calendar results."}</p>
            {replyReady ? <div className="reply-line"><MessageSquareReply size={13} /><span><strong>A replied:</strong> {mission.artifacts.externalReply}</span></div> : null}
          </div>
        </section>

        <section className={`output-row ${eventCreated || eventProposed ? "is-ready" : ""}`}>
          <div className="output-icon"><CalendarCheck2 size={15} /></div>
          <div className="min-w-0 flex-1">
            <div className="output-heading"><strong>Calendar event</strong><span>{eventCreated ? "CREATED" : eventProposed ? "PROPOSED" : mission.status === "CANCELLED" ? "BLOCKED" : "WAITING"}</span></div>
            {eventCreated || eventProposed ? (
              <div className="event-output">
                <div><strong>{mission.artifacts.calendarEvent.title}</strong><span>{mission.artifacts.calendarEvent.date} · {mission.artifacts.calendarEvent.time} · A invited</span></div>
                {eventCreated ? <a className="download-link pressable" href={inviteUrl}><Download size={13} /> Download .ics</a> : <span className="font-mono text-[9px] text-[var(--clay)]">AWAITING APPROVAL</span>}
              </div>
            ) : <p>Henry will not write to the calendar before approval.</p>}
          </div>
        </section>
      </div>
    </article>
  );
}
