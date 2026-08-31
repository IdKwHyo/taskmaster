"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Check, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck, X } from "lucide-react";
import type { CalendarCandidate, CalendarSnapshot } from "@/lib/calendar-sync";
import type { PrototypeMission } from "@/lib/henry-prototype";

const DAY_START = 9 * 60;
const DAY_END = 18 * 60;

function blockStyle(startMinute: number, endMinute: number) {
  const range = DAY_END - DAY_START;
  const top = Math.max(0, ((startMinute - DAY_START) / range) * 100);
  const height = Math.max(6, ((Math.min(endMinute, DAY_END) - Math.max(startMinute, DAY_START)) / range) * 100);
  return { top: `${top}%`, height: `${height}%` };
}

function stageFor(mission: PrototypeMission) {
  if (mission.status === "COMPLETED") return { title: "Event committed", detail: "The approved event is now part of the calendar.", code: "EVENTS.INSERT · 200 OK" };
  if (mission.status === "NEEDS_APPROVAL") return { title: "Change prepared", detail: "The chosen time is staged but has not been written.", code: "PROPOSED · APPROVAL REQUIRED" };
  if (mission.status === "WAITING_EXTERNAL") return { title: "Calendar context preserved", detail: "Henry is asleep until A replies. No polling is running.", code: "SUSPENDED · 0 ACTIVE CALLS" };
  if (mission.currentStep >= 2) return { title: "Availability ready", detail: "Henry is using these windows in the message to A.", code: "FREEBUSY COMPLETE" };
  return { title: "Scanning availability", detail: "Comparing existing commitments with the requested meeting window.", code: "CALENDAR.EVENTS.LIST" };
}

function CandidateDetail({ candidate }: { candidate: CalendarCandidate }) {
  return (
    <div className={`calendar-rationale ${candidate.available ? "" : "conflict"}`}>
      <div><strong>{candidate.label}</strong><span>{candidate.available ? `${candidate.score}% fit` : "Conflict"}</span></div>
      <p>{candidate.reason}</p>
    </div>
  );
}

export default function CalendarWindow({ mission, onClose }: { mission: PrototypeMission; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<CalendarSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const stage = stageFor(mission);
  const requestClose = useCallback(() => setClosing(true), []);

  useEffect(() => {
    let active = true;
    fetch("/api/calendar", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Calendar sync failed");
        return response.json() as Promise<CalendarSnapshot>;
      })
      .then((next) => {
        if (!active) return;
        setSnapshot(next);
        setSelectedCandidateId(next.candidates.find((candidate) => candidate.selected)?.id ?? next.candidates[0]?.id ?? null);
      })
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && requestClose();
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [requestClose]);

  const selectedCandidate = useMemo(() => snapshot?.candidates.find((candidate) => candidate.id === selectedCandidateId) ?? snapshot?.candidates[0], [snapshot, selectedCandidateId]);
  const showProposedEvent = mission.status === "NEEDS_APPROVAL" || mission.status === "COMPLETED";

  return (
    <div className={`impact-backdrop ${closing ? "is-closing" : ""}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <section className={`calendar-window ${closing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="calendar-window-title" onAnimationEnd={(event) => closing && event.target === event.currentTarget && onClose()}>
        <header className="calendar-window-header">
          <div className="calendar-app-mark"><CalendarDays size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="calendar-title-line"><h2 id="calendar-window-title">Google Calendar</h2><span className={`sync-source ${snapshot?.syncState ?? "demo"}`}>{snapshot?.syncState === "live" ? "Live sync" : snapshot?.syncState === "error" ? "Sync issue" : "Demo data"}</span></div>
            <p>{snapshot?.account ?? "Connecting to calendar…"} · {snapshot?.calendarName ?? "Primary calendar"}</p>
          </div>
          <button className="window-icon-button pressable" onClick={() => { setLoading(true); setRefreshKey((value) => value + 1); }} aria-label="Refresh Google Calendar"><RefreshCw size={14} className={loading ? "is-spinning" : ""} /></button>
          <button ref={closeButtonRef} className="window-icon-button pressable" onClick={requestClose} aria-label="Close Google Calendar"><X size={15} /></button>
        </header>

        <div className="calendar-stage-bar">
          <div><span className="eyebrow"><ShieldCheck size={11} /> Live work surface</span><strong>{stage.title}</strong><p>{stage.detail}</p></div>
          <span className="stage-code">{stage.code}</span>
        </div>

        {loading || !snapshot ? (
          <div className="calendar-loading"><LoaderCircle size={20} /><span>Reading Google Calendar</span><small>Finding conflicts and candidate windows</small></div>
        ) : (
          <div className="calendar-window-body">
            <div className="calendar-grid-wrap">
              <div className="calendar-grid-head">
                <div className="calendar-time-head">{snapshot.rangeLabel}</div>
                {snapshot.days.map((day) => <div key={day.date}><strong>{day.day}</strong><span>{day.dateLabel}</span></div>)}
              </div>
              <div className="calendar-grid">
                <div className="calendar-times">{[9, 12, 15, 18].map((hour) => <span key={hour} style={{ top: `${((hour * 60 - DAY_START) / (DAY_END - DAY_START)) * 100}%` }}>{String(hour).padStart(2, "0")}:00</span>)}</div>
                {snapshot.days.map((day, dayIndex) => (
                  <div className="calendar-day" key={day.date}>
                    {snapshot.events.filter((event) => event.dayIndex === dayIndex).map((event) => (
                      <div key={event.id} className="calendar-event-block" style={blockStyle(event.startMinute, event.endMinute)}><span>{event.title}</span></div>
                    ))}
                    {snapshot.candidates.filter((candidate) => candidate.dayIndex === dayIndex).map((candidate) => (
                      <button key={candidate.id} onClick={() => setSelectedCandidateId(candidate.id)} className={`candidate-block ${candidate.available ? "available" : "unavailable"} ${candidate.selected ? "recommended" : ""} ${selectedCandidateId === candidate.id ? "inspected" : ""}`} style={blockStyle(candidate.startMinute, candidate.endMinute)}>
                        {candidate.selected ? <Check size={10} /> : null}<span>{candidate.label.split(" ")[1]}</span>
                      </button>
                    ))}
                    {showProposedEvent && dayIndex === 1 ? <div className={`proposed-event ${mission.status === "COMPLETED" ? "committed" : ""}`} style={blockStyle(15 * 60 + 30, 16 * 60)}><span>{mission.outcome}</span><small>{mission.status === "COMPLETED" ? "CREATED" : "PROPOSED"}</small></div> : null}
                    {(loading || (mission.status === "RUNNING" && mission.currentStep <= 1)) && <i className="calendar-scan-line" />}
                  </div>
                ))}
              </div>
            </div>

            <aside className="calendar-inspector">
              <div className="calendar-inspector-heading"><span>Candidate analysis</span><span>{snapshot.candidates.filter((candidate) => candidate.available).length} AVAILABLE</span></div>
              <div className="candidate-list">
                {snapshot.candidates.map((candidate) => (
                  <button key={candidate.id} onClick={() => setSelectedCandidateId(candidate.id)} className={selectedCandidateId === candidate.id ? "selected" : ""}>
                    <span>{candidate.label}</span><strong>{candidate.available ? `${candidate.score}%` : "BUSY"}</strong>
                  </button>
                ))}
              </div>
              {selectedCandidate ? <CandidateDetail candidate={selectedCandidate} /> : null}
              <div className="calendar-constraints"><span>Constraints applied</span><p>30 minutes · next workweek · 09:00–18:00 · avoid conflicts</p></div>
              <a className="google-open-button pressable" href="https://calendar.google.com/calendar/u/0/r/week" target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open full calendar</a>
            </aside>
          </div>
        )}

        <footer className="calendar-window-footer">
          <span>{snapshot?.warning ? `FALLBACK · ${snapshot.warning}` : snapshot?.syncState === "live" ? "GOOGLE CALENDAR API · READ-ONLY VIEW" : "GOOGLE CALENDAR ADAPTER · DEMO FALLBACK"}</span>
          <span>{snapshot ? `${snapshot.latencyMs}MS · 1 API CALL · $0.001` : "CONNECTING"}</span>
        </footer>
      </section>
    </div>
  );
}
