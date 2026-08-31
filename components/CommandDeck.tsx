"use client";

import { ArrowRight, AudioLines, CheckCircle2, Command, Plus, ShieldCheck, Volume2, VolumeX } from "lucide-react";
import type { HenryCommandResponse, HenryCommandSurface } from "@/lib/henry-command";

export type CommandMode = "brief" | "delegate";

type Props = {
  mode: CommandMode;
  value: string;
  creating: boolean;
  briefingOpen: boolean;
  response: HenryCommandResponse | null;
  speaking: boolean;
  voiceEnabled: boolean;
  voiceAvailable: boolean;
  onModeChange: (mode: CommandMode) => void;
  onValueChange: (value: string) => void;
  onSubmit: () => void;
  onQuickCommand: (query: string) => void;
  onOpenSurface: (surface: HenryCommandSurface) => void;
  onToggleVoice: () => void;
};

const QUICK_COMMANDS = ["What's on my day?", "Why are you waiting?", "Show mission cost", "A rejected the time"];

export default function CommandDeck({ mode, value, creating, briefingOpen, response, speaking, voiceEnabled, voiceAvailable, onModeChange, onValueChange, onSubmit, onQuickCommand, onOpenSurface, onToggleVoice }: Props) {
  const briefing = mode === "brief";
  return (
    <section data-reveal className={`command-deck ${briefing ? "is-conversational" : "is-delegating"} ${speaking ? "is-speaking" : ""}`}>
      <div className="command-deck-head">
        <div className="command-modes" role="tablist" aria-label="Henry command mode">
          <button role="tab" aria-selected={briefing} onClick={() => onModeChange("brief")}>Talk to Henry</button>
          <button role="tab" aria-selected={!briefing} onClick={() => onModeChange("delegate")}>Delegate outcome</button>
        </div>
        <div className="command-status-group">
          <span className="command-state"><i /> {speaking ? voiceAvailable && voiceEnabled ? "SPEAKING" : "RESPONDING" : briefing ? "AVAILABLE · NO FOREGROUND EXECUTION" : "OUTCOME CONTRACT · READY"}</span>
          {briefing ? <button className="voice-toggle" disabled={!voiceAvailable} aria-label={voiceEnabled ? "Mute Henry" : "Enable Henry voice"} aria-pressed={voiceEnabled} onClick={onToggleVoice}>{voiceEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}</button> : null}
        </div>
      </div>

      <div className="command-entry">
        <div className="conversation-signal" aria-hidden="true">
          <i className="signal-ring ring-one" />
          <i className="signal-ring ring-two" />
          <i className="signal-ring ring-three" />
          {briefing ? <AudioLines size={15} /> : <Command size={15} />}
          {speaking ? <span className="speech-bars"><i /><i /><i /><i /></span> : null}
        </div>
        <input
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && onSubmit()}
          placeholder={briefing ? "What needs my attention today?" : "Coordinate a 30-minute project review with A before Thursday…"}
          aria-label={briefing ? "Ask Henry for an operational briefing" : "Outcome to delegate"}
          maxLength={240}
        />
        <button disabled={creating || (!briefing && !value.trim())} onClick={onSubmit} className={`command-submit pressable ${creating ? "is-done" : ""}`}>
          {creating ? <CheckCircle2 size={14} /> : briefing ? <ArrowRight size={14} /> : <Plus size={14} />}
          {creating ? "Working" : briefing ? "Ask Henry" : "Delegate"}
        </button>
      </div>

      {briefingOpen && briefing && response ? (
        <div className="operations-brief panel-enter" aria-live="polite">
          <div className="brief-lead">
            <span className="eyebrow"><AudioLines size={11} /> Operational brief</span>
            <strong>{response.headline}</strong>
            <p>{response.summary}</p>
          </div>
          <div className="brief-facts">
            {response.facts.map((fact) => (
              <button key={fact.label} onClick={() => onOpenSurface(fact.surface)}><span>{fact.label}</span><strong>{fact.value}</strong><small>{fact.detail}</small></button>
            ))}
          </div>
          {response.agenda ? (
            <div className="day-lens">
              <div className="day-lens-head"><span>{response.agenda.dateLabel}</span><code>DEMO CALENDAR · CLICK CALENDAR FACT TO INSPECT</code></div>
              <div className="day-lens-flow">
                {response.agenda.items.slice(0, 2).map((item) => <div key={item.id} className="day-event"><time>{item.time}</time><strong>{item.title}</strong><small>UNTIL {item.endTime}</small></div>)}
                <div className="day-focus"><time>{response.agenda.focusWindow}</time><strong>Protected focus</strong><small>BEST OPEN WINDOW</small></div>
                {response.agenda.items.slice(2).map((item) => <div key={item.id} className="day-event"><time>{item.time}</time><strong>{item.title}</strong><small>UNTIL {item.endTime}</small></div>)}
              </div>
            </div>
          ) : null}
          <div className="brief-assurance"><ShieldCheck size={12} /><span><b>Recommended:</b> {response.recommendation}</span><code>{response.changedMission ? "STATE CHANGED" : "READ FROM MISSION ENGINE"}</code></div>
        </div>
      ) : (
        <div className="command-foot">
          {briefing ? <div className="command-suggestions"><span>TRY</span>{QUICK_COMMANDS.map((query) => <button key={query} onClick={() => onQuickCommand(query)}>{query}</button>)}</div> : <span>Henry will shadow-test routes before performing any external action.</span>}
          <code>{briefing ? "COMMAND.SURFACE · ENGINE GROUNDED" : "MISSION.TWIN · DRY_RUN_FIRST"}</code>
        </div>
      )}
    </section>
  );
}
