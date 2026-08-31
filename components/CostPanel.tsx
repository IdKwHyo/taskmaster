import { Activity, CircleDollarSign, Gauge, ShieldCheck } from "lucide-react";
import type { PrototypeMission } from "@/lib/henry-prototype";

export default function CostPanel({ mission }: { mission: PrototypeMission }) {
  const missionEstimate = mission.estimatedCost;
  return (
    <article id="admin" className="cost-material guardrail-panel scroll-mt-20">
      <div className="flex items-center justify-between">
        <span className="eyebrow"><ShieldCheck size={12} /> Run guardrails</span>
        <span className="font-mono text-[9px] text-[var(--faint)]">PROTOTYPE</span>
      </div>
      <div className="guardrail-list">
        <div><span><Activity size={13} /> Model calls</span><strong>{mission.modelCalls}</strong></div>
        <div><span><Gauge size={13} /> Step limit</span><strong>8 max</strong></div>
        <div><span><CircleDollarSign size={13} /> Mission cost</span><strong>${missionEstimate.toFixed(3)}</strong></div>
      </div>
      <p>Henry stops at external waits and approval boundaries instead of running continuously.</p>
    </article>
  );
}
