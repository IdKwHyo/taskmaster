"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Bot, CircleDollarSign, Gauge, ShieldCheck, Wrench, X } from "lucide-react";
import type { PrototypeMission } from "@/lib/henry-prototype";

const STEP_COSTS = [
  { label: "Plan outcome", type: "Runner", cost: 0 },
  { label: "Google Calendar scan", type: "Tool", cost: .001 },
  { label: "Send availability", type: "Tool", cost: .001 },
  { label: "Wait for reply", type: "Suspended", cost: 0 },
  { label: "Human approval", type: "Boundary", cost: 0 },
  { label: "Create event", type: "Tool", cost: .002 },
];

export default function CostInspector({ mission, onClose }: { mission: PrototypeMission; onClose: () => void }) {
  const total = mission.estimatedCost;
  const [closing, setClosing] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestClose = useCallback(() => setClosing(true), []);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && requestClose();
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus({ preventScroll: true });
    };
  }, [requestClose]);

  return (
    <div className={`cost-backdrop ${closing ? "is-closing" : ""}`} role="presentation" onMouseDown={(event) => event.target === event.currentTarget && requestClose()}>
      <aside className={`cost-inspector ${closing ? "is-closing" : ""}`} role="dialog" aria-modal="true" aria-labelledby="cost-inspector-title" onAnimationEnd={(event) => closing && event.target === event.currentTarget && onClose()}>
        <header>
          <div><span className="eyebrow"><CircleDollarSign size={12} /> Mission economics</span><h2 id="cost-inspector-title">Cost and limits</h2></div>
          <button ref={closeButtonRef} className="window-icon-button pressable" onClick={requestClose} aria-label="Close cost inspector"><X size={15} /></button>
        </header>

        <section className="cost-total">
          <div><span>Estimated mission cost</span><strong>${total.toFixed(3)}</strong></div>
          <span className="budget-safe"><ShieldCheck size={12} /> Within limit</span>
          <div className="cost-meter"><i style={{ width: `${Math.max(.4, total / 20 * 100)}%` }} /></div>
          <p>${total.toFixed(3)} used from the $20 workflow ceiling</p>
        </section>

        <div className="cost-metrics">
          <div><Bot size={14} /><span>Gemini calls</span><strong>{mission.modelCalls} / 6</strong></div>
          <div><Wrench size={14} /><span>Tool calls</span><strong>{mission.toolCalls}</strong></div>
          <div><Gauge size={14} /><span>Steps</span><strong>{mission.status === "COMPLETED" ? 6 : mission.currentStep + 1} / 8</strong></div>
          <div><Activity size={14} /><span>Execution</span><strong>{mission.paused ? "Paused" : mission.status === "WAITING_EXTERNAL" ? "Asleep" : "Bounded"}</strong></div>
        </div>

        <section className="cost-ledger">
          <div className="cost-ledger-head"><span>Step ledger</span><span>ESTIMATE</span></div>
          {STEP_COSTS.map((step, index) => {
            const reached = mission.status === "COMPLETED" || index <= mission.currentStep;
            return <div key={step.label} className={reached ? "reached" : ""}><i>{index + 1}</i><span><strong>{step.label}</strong><small>{step.type}</small></span><b>{reached ? `$${step.cost.toFixed(3)}` : "—"}</b></div>;
          })}
        </section>

        <div className="cost-policy"><ShieldCheck size={14} /><p><strong>Spend policy enforced.</strong> Henry sleeps at external waits, stops at eight steps, and requires approval before writes.</p></div>
      </aside>
    </div>
  );
}
