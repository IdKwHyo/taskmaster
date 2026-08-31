"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import {
  Bell,
  CircleDollarSign,
  FileClock,
  GitBranch,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import ApprovalCard from "@/components/ApprovalCard";
import CalendarWindow from "@/components/CalendarWindow";
import CommandDeck, { type CommandMode } from "@/components/CommandDeck";
import CostPanel from "@/components/CostPanel";
import CostInspector from "@/components/CostInspector";
import GradualBlur from "@/components/GradualBlur";
import MissionGraph from "@/components/MissionGraph";
import MissionOverview from "@/components/MissionOverview";
import MissionQueue, { type QueueKey } from "@/components/MissionQueue";
import HenryPresence from "@/components/HenryPresence";
import { briefMission, type HenryCommandResponse, type HenryCommandSurface } from "@/lib/henry-command";
import { seedMission, type PrototypeAction, type PrototypeMission, type PrototypeScenario } from "@/lib/henry-prototype";

const HenryCore3D = dynamic(() => import("@/components/HenryCore3D"), { ssr: false });
const STORAGE_KEY = "henry.prototype.mission.v3";
const VOICE_KEY = "henry.prototype.voice.enabled";
type MissionView = "overview" | "execution" | "activity";

const navigation = [
  { label: "Overview", icon: LayoutDashboard, target: "overview" },
  { label: "Missions", icon: GitBranch, target: "mission", active: true },
  { label: "Approvals", icon: ShieldCheck, target: "approvals" },
  { label: "Activity", icon: FileClock, target: "activity" },
  { label: "Admin", icon: Settings2, target: "admin" },
];

type PrototypeResult = { mission: PrototypeMission; response?: HenryCommandResponse };

async function callPrototype(action: PrototypeAction): Promise<PrototypeResult> {
  const response = await fetch("/api/prototype", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(action),
  });
  const payload = await response.json() as { mission?: PrototypeMission; response?: HenryCommandResponse; error?: string };
  if (!response.ok || !payload.mission) throw new Error(payload.error ?? "Prototype runner did not respond.");
  return { mission: payload.mission, response: payload.response };
}

function isStoredMission(value: unknown): value is PrototypeMission {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PrototypeMission>;
  return typeof candidate.id === "string" && typeof candidate.outcome === "string" && Array.isArray(candidate.steps) && candidate.steps.length === 6 && Boolean(candidate.artifacts) && Boolean(candidate.twin);
}

export default function Home() {
  const rootRef = useRef<HTMLDivElement>(null);
  const calendarOpenedForMission = useRef<string | null>(null);
  const speechToken = useRef(0);
  const [mission, setMission] = useState<PrototypeMission>(() => seedMission());
  const [missionView, setMissionView] = useState<MissionView>("overview");
  const [commandMode, setCommandMode] = useState<CommandMode>("brief");
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [commandResponse, setCommandResponse] = useState<HenryCommandResponse | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [selectedQueueKey, setSelectedQueueKey] = useState<QueueKey>("review");
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [costOpen, setCostOpen] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [missionHistory, setMissionHistory] = useState<PrototypeMission[]>([]);

  useLayoutEffect(() => {
    if (!rootRef.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const context = gsap.context(() => {
      gsap.from("[data-reveal]", { opacity: 0, y: 10, duration: 0.42, stagger: 0.045, ease: "power2.out" });
    }, rootRef);
    return () => context.revert();
  }, []);

  useEffect(() => {
    let restored: PrototypeMission | null = null;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as unknown;
        if (isStoredMission(parsed)) restored = parsed;
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    const timer = window.setTimeout(() => {
      if (restored) setMission(restored);
      setHydrated(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const storedVoice = window.localStorage.getItem(VOICE_KEY);
    const timer = window.setTimeout(() => {
      setVoiceAvailable("speechSynthesis" in window && "SpeechSynthesisUtterance" in window);
      if (storedVoice !== null) setVoiceEnabled(storedVoice === "true");
    }, 0);
    return () => {
      window.clearTimeout(timer);
      speechToken.current += 1;
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    if (hydrated) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mission));
  }, [hydrated, mission]);

  const perform = useCallback(async (type: "advance" | "external_reply" | "external_reject" | "approve" | "reject" | "toggle_pause") => {
    setBusy(true);
    setError(null);
    try {
      const { mission: nextMission } = await callPrototype({ type, mission });
      setMissionHistory((history) => [...history, mission].slice(-20));
      setMission(nextMission);
      if (briefingOpen) setCommandResponse(briefMission(nextMission));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The prototype action failed.");
    } finally {
      setBusy(false);
    }
  }, [briefingOpen, mission]);

  useEffect(() => {
    if (!hydrated || !autoPlay || busy || mission.paused || mission.status !== "RUNNING") return;
    const baseDelay = mission.currentStep === 1 ? 3000 : mission.currentStep === 2 ? 2200 : 1100;
    const timer = window.setTimeout(() => void perform("advance"), baseDelay / playbackSpeed);
    return () => window.clearTimeout(timer);
  }, [autoPlay, busy, hydrated, mission, perform, playbackSpeed]);

  useEffect(() => {
    if (!hydrated || mission.paused || mission.simulation || mission.status !== "RUNNING" || mission.currentStep !== 1 || calendarOpenedForMission.current === mission.id) return;
    calendarOpenedForMission.current = mission.id;
    setCalendarOpen(true);
  }, [hydrated, mission.currentStep, mission.id, mission.paused, mission.simulation, mission.status]);

  async function delegateOutcome(value = outcome) {
    if (!value.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const { mission: nextMission } = await callPrototype({ type: "create", outcome: value });
      setMission(nextMission);
      setMissionHistory([]);
      setSelectedQueueKey("review");
      setBriefingOpen(false);
      setCommandResponse(null);
      setAutoPlay(true);
      setMissionView("overview");
      setOutcome("");
      document.getElementById("mission")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Henry could not accept that outcome.");
    } finally {
      setCreating(false);
    }
  }

  function stepBack() {
    const previous = missionHistory.at(-1);
    if (!previous) return;
    setAutoPlay(false);
    setMission(previous);
    setMissionHistory((history) => history.slice(0, -1));
  }

  function stepForward() {
    setAutoPlay(false);
    if (mission.status === "WAITING_EXTERNAL") void perform("external_reply");
    else if (mission.status === "RUNNING") void perform("advance");
  }

  async function loadScenario(scenario: PrototypeScenario, key: QueueKey = "review", scenarioOutcome?: string) {
    setBusy(true);
    setError(null);
    try {
      const { mission: nextMission } = await callPrototype({ type: "scenario", scenario, outcome: scenarioOutcome });
      setMission(nextMission);
      setMissionHistory([]);
      setSelectedQueueKey(key);
      setAutoPlay(false);
      setCalendarOpen(false);
      setCommandResponse(null);
      setMissionView("overview");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The test scenario could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  function openCommandSurface(surface: HenryCommandSurface) {
    if (surface === "calendar") setCalendarOpen(true);
    else if (surface === "cost") setCostOpen(true);
    else if (surface === "approval") document.getElementById("approvals")?.scrollIntoView({ behavior: "smooth", block: "center" });
    else if (surface === "mission") document.getElementById("mission")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function speakResponse(response: HenryCommandResponse) {
    const token = speechToken.current + 1;
    speechToken.current = token;
    window.speechSynthesis?.cancel();
    setSpeaking(true);

    if (!voiceEnabled || !voiceAvailable) {
      window.setTimeout(() => { if (speechToken.current === token) setSpeaking(false); }, 2200);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(response.speech);
    const voices = window.speechSynthesis.getVoices();
    utterance.voice = voices.find((voice) => voice.lang.startsWith("en") && /Samantha|Google|Natural/i.test(voice.name))
      ?? voices.find((voice) => voice.lang.startsWith("en"))
      ?? null;
    utterance.rate = 0.98;
    utterance.pitch = 0.92;
    utterance.volume = 0.82;
    utterance.onstart = () => { if (speechToken.current === token) setSpeaking(true); };
    utterance.onend = () => { if (speechToken.current === token) setSpeaking(false); };
    utterance.onerror = () => { if (speechToken.current === token) setSpeaking(false); };
    window.speechSynthesis.speak(utterance);
  }

  function toggleVoice() {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    window.localStorage.setItem(VOICE_KEY, String(next));
    if (!next) {
      speechToken.current += 1;
      window.speechSynthesis?.cancel();
      setSpeaking(false);
    }
  }

  async function runCommand(value = outcome) {
    if (commandBusy) return;
    setCommandBusy(true);
    setError(null);
    try {
      const result = await callPrototype({ type: "command", query: value || "What needs my attention?", mission });
      if (result.response?.changedMission) setMissionHistory((history) => [...history, mission].slice(-20));
      setMission(result.mission);
      const nextResponse = result.response ?? briefMission(result.mission);
      setCommandResponse(nextResponse);
      setBriefingOpen(true);
      setOutcome("");
      speakResponse(nextResponse);
      if (result.response?.surface && result.response.surface !== "none") {
        window.setTimeout(() => openCommandSurface(result.response?.surface ?? "none"), 120);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Henry could not interpret that command.");
    } finally {
      setCommandBusy(false);
    }
  }

  function submitCommand() {
    if (commandMode === "brief") void runCommand();
    else void delegateOutcome();
  }

  function navigate(target: string) {
    if (target === "overview") {
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    if (target === "activity") setMissionView("activity");
    if (target === "mission") setMissionView("overview");
    window.setTimeout(() => document.getElementById(target === "activity" ? "mission" : target)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  const statusLabel = mission.paused ? "PAUSED" : mission.status;
  const approvalCount = mission.status === "NEEDS_APPROVAL" ? 1 : 0;
  const currentStep = mission.status === "COMPLETED" ? 6 : mission.currentStep + 1;
  const ambientBrief = briefMission(mission);

  return (
    <div ref={rootRef} className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <div className="ambient-stage fixed inset-0 z-0 isolate overflow-hidden" aria-hidden="true">
        <HenryCore3D status={mission.status} twinState={mission.twin.state} paused={mission.paused} speaking={speaking} />
        <GradualBlur divCount={6} height="8rem" position="top" strength={2} zIndex={50} />
        <GradualBlur divCount={6} height="8rem" position="bottom" strength={2} zIndex={50} />
      </div>

      <aside className="sidebar-material fixed inset-y-0 left-0 z-30 hidden w-[216px] flex-col px-3 py-4 lg:flex">
        <div className="flex items-center gap-3 px-2 py-2">
          <div className="henry-mark">H</div>
          <div><div className="text-[15px] font-semibold tracking-[-0.015em]">Henry</div><div className="mt-0.5 text-[11px] text-[var(--muted)]">Autonomous agent</div></div>
        </div>

        <nav className="mt-7 space-y-1" aria-label="Primary navigation">
          {navigation.map(({ label, icon: Icon, target, active }) => (
            <button key={label} onClick={() => navigate(target)} className={`nav-control ${active ? "is-active" : ""}`}>
              <Icon size={16} strokeWidth={1.8} /><span>{label}</span>
              {label === "Approvals" && approvalCount > 0 ? <span className="nav-count">{approvalCount}</span> : null}
            </button>
          ))}
        </nav>

        <div className="mt-auto px-2 pb-1">
          <div className="flex items-center justify-between border-t border-[var(--line)] pt-4 text-[11px] text-[var(--muted)]">
            <span className="flex items-center gap-2"><i className="status-dot status-live" /> Mission engine ready</span>
            <button className="pressable text-[var(--muted)]" aria-label="Settings"><Settings2 size={15} /></button>
          </div>
          <div className="mt-2 font-mono text-[9px] tracking-[0.04em] text-[var(--faint)]">MISSION TWIN · SHADOW MODE</div>
        </div>
      </aside>

      <main id="overview" className="relative z-10 min-h-screen scroll-mt-20 lg:pl-[216px]">
        <header className="top-material sticky top-0 z-20 flex h-[60px] items-center px-5 sm:px-8">
          <div className="flex items-center gap-3 lg:hidden"><div className="henry-mark small">H</div><span className="font-semibold">Henry</span></div>
          <div className="hidden lg:block"><div className="text-[13px] font-medium">Mission control</div><div className="text-[10px] text-[var(--muted)]">Interactive prototype</div></div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden items-center gap-2 text-[11px] text-[var(--muted)] sm:flex"><i className="status-dot status-live" /> {mission.backend === "cloud" ? "Henry Cloud connected" : "Interactive engine ready"}</div>
            <button className="toolbar-button pressable" aria-label="Notifications"><Bell size={15} /></button>
            <button className="profile-button pressable" aria-label="Account">GU</button>
          </div>
        </header>

        <div className="mx-auto max-w-[1420px] px-5 pb-16 pt-7 sm:px-8 lg:px-10">
          <section data-reveal className="page-intro">
            <div>
              <div className="eyebrow"><Sparkles size={12} /> Mission Twin</div>
              <h1 className="display-title mt-2">{ambientBrief.headline}</h1>
              <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[var(--muted)]">{ambientBrief.summary}</p>
            </div>
            <HenryPresence mission={mission} speaking={speaking} />
          </section>

          <CommandDeck
            mode={commandMode}
            value={outcome}
            creating={creating || commandBusy}
            briefingOpen={briefingOpen}
            response={commandResponse}
            speaking={speaking}
            voiceEnabled={voiceEnabled}
            voiceAvailable={voiceAvailable}
            onModeChange={(mode) => { setCommandMode(mode); setBriefingOpen(false); setOutcome(""); }}
            onValueChange={setOutcome}
            onSubmit={submitCommand}
            onQuickCommand={(query) => void runCommand(query)}
            onOpenSurface={openCommandSurface}
            onToggleVoice={toggleVoice}
          />
          {error ? <div className="delegate-error command-error" role="alert">{error}</div> : null}

          <MissionQueue
            selectedKey={selectedQueueKey}
            mission={mission}
            busy={busy}
            onSelect={(item) => void loadScenario(item.scenario, item.key, item.outcome)}
          />

          <div className="mission-layout">
            <section id="mission" data-reveal className="primary-material mission-cockpit scroll-mt-20 overflow-hidden">
              <div className="mission-header flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--sage-deep)]"><i className={`status-dot ${mission.status === "RUNNING" || mission.status === "COMPLETED" ? "status-live" : "status-waiting"}`} /> {statusLabel.replaceAll("_", " ")}<span className="font-mono text-[9px] font-normal text-[var(--faint)]">{mission.id}</span></div>
                  <h2 className="mt-2 truncate text-[20px] font-semibold tracking-[-0.025em]">{mission.outcome}</h2>
                  <div className="mission-meta mt-1.5"><span>Started {mission.startedAt.slice(11, 16)} UTC</span><span>Step {currentStep} of 6</span><button className="mission-cost-trigger pressable" onClick={() => setCostOpen(true)}><CircleDollarSign size={11} /> Cost ${mission.estimatedCost.toFixed(3)}</button></div>
                  <div className="authority-envelope" aria-label="Delegated authority envelope">
                    <div><span>AUTHORIZED</span><strong>Inspect calendars · message A once · create event</strong></div>
                    <div><span>ASK BEFORE</span><strong>Moving commitments · second message</strong></div>
                    <div><span>SPEND LIMIT</span><strong>$0.10</strong></div>
                  </div>
                </div>
              </div>

              <nav className="mission-tabs" aria-label="Mission detail" role="tablist">
                {(["overview", "execution", "activity"] as MissionView[]).map((view) => (
                  <button key={view} role="tab" aria-selected={missionView === view} aria-controls="mission-panel" onClick={() => setMissionView(view)}>{view === "overview" ? "Overview" : view === "execution" ? "Execution map" : "Activity"}</button>
                ))}
              </nav>

              <div id="mission-panel" className="mission-panel" role="tabpanel">
                {missionView === "overview" ? <MissionOverview mission={mission} autoPlay={autoPlay} speed={playbackSpeed} busy={busy} canGoBack={missionHistory.length > 0} onOpenCalendar={() => setCalendarOpen(true)} onBack={stepBack} onNext={stepForward} onTogglePlay={() => setAutoPlay((value) => !value)} onReplay={() => void delegateOutcome(mission.outcome)} onSpeedChange={setPlaybackSpeed} onScenario={(scenario) => void loadScenario(scenario)} /> : null}
                {missionView === "execution" ? <div className="panel-enter"><MissionGraph mission={mission} /></div> : null}
                {missionView === "activity" ? (
                  <article id="activity" className="mission-activity panel-enter">
                    <div className="section-heading"><div><span className="eyebrow"><FileClock size={12} /> Activity</span><h2>Execution record</h2></div><span className="font-mono text-[9px] text-[var(--faint)]">LATEST FIRST</span></div>
                    <div className="activity-list">
                      {mission.events.slice(0, 8).map((item) => (
                        <div key={item.id} className="activity-row"><i className={`status-dot ${item.tone === "live" ? "status-live" : item.tone === "neutral" ? "bg-slate-500" : "status-waiting"}`} /><div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{item.title}</div><div className="mt-0.5 truncate font-mono text-[9px] text-[var(--muted)]">{item.time} · {item.detail}</div></div></div>
                      ))}
                    </div>
                  </article>
                ) : null}
              </div>
            </section>

            <aside className="mission-side">
              <div data-reveal><ApprovalCard mission={mission} busy={busy} onAction={(action) => {
                if (action === "approve" || action === "external_reject") setAutoPlay(true);
                void perform(action);
              }} /></div>
              <div data-reveal><CostPanel mission={mission} /></div>
            </aside>
          </div>
        </div>
      </main>
      {calendarOpen ? <CalendarWindow mission={mission} onClose={() => setCalendarOpen(false)} /> : null}
      {costOpen ? <CostInspector mission={mission} onClose={() => setCostOpen(false)} /> : null}
    </div>
  );
}
