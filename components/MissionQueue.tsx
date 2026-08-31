"use client";

import { ChevronRight } from "lucide-react";
import type { MissionStatus, PrototypeMission, PrototypeScenario } from "@/lib/henry-prototype";

export type QueueKey = "review" | "venue" | "briefing" | "report";

type QueueItem = {
  key: QueueKey;
  title: string;
  status: MissionStatus;
  next: string;
  progress: string;
  cost: number;
  scenario: PrototypeScenario;
};

const ITEMS: QueueItem[] = [
  { key: "review", title: "Coordinate project review", status: "RUNNING", next: "Shadow route", progress: "1/6", cost: .004, scenario: "standard" },
  { key: "venue", title: "Confirm launch-dinner venue", status: "WAITING_EXTERNAL", next: "Vendor reply", progress: "3/6", cost: .003, scenario: "waiting_reply" },
  { key: "briefing", title: "Distribute leadership brief", status: "NEEDS_APPROVAL", next: "Your decision", progress: "5/6", cost: .006, scenario: "approval_needed" },
  { key: "report", title: "Prepare weekly operations report", status: "COMPLETED", next: "Verified", progress: "6/6", cost: .009, scenario: "completed" },
];

const STATUS_LABEL: Record<MissionStatus, string> = {
  RUNNING: "RUNNING",
  WAITING_EXTERNAL: "WAITING",
  NEEDS_APPROVAL: "APPROVAL",
  COMPLETED: "COMPLETED",
  CANCELLED: "CANCELLED",
  FAILED: "FAILED",
};

type Props = {
  selectedKey: QueueKey;
  mission: PrototypeMission;
  busy: boolean;
  onSelect: (item: { key: QueueKey; scenario: PrototypeScenario; outcome: string }) => void;
};

export default function MissionQueue({ selectedKey, mission, busy, onSelect }: Props) {
  return (
    <section data-reveal className="mission-queue-strip" aria-label="Missions under management">
      <div className="queue-strip-head"><span>Mission queue</span><code>4 UNDER MANAGEMENT · ONE IN FOCUS</code></div>
      <div className="queue-strip-grid">
        {ITEMS.map((item) => {
          const selected = item.key === selectedKey;
          const status = selected ? mission.status : item.status;
          const progress = selected ? `${mission.status === "COMPLETED" ? 6 : mission.currentStep + 1}/6` : item.progress;
          const cost = selected ? mission.estimatedCost : item.cost;
          const title = selected ? mission.outcome : item.title;
          return (
            <button key={item.key} disabled={busy} aria-current={selected ? "true" : undefined} onClick={() => onSelect({ key: item.key, scenario: item.scenario, outcome: item.title })}>
              <div className="queue-strip-status"><i className={`queue-dot ${status.toLowerCase()}`} /><span>{STATUS_LABEL[status]}</span><code>{progress}</code></div>
              <strong>{title}</strong>
              <div className="queue-strip-meta"><span>{selected ? mission.status === "COMPLETED" ? "Verified" : item.next : item.next}</span><code>${cost.toFixed(3)}</code><ChevronRight size={11} /></div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
