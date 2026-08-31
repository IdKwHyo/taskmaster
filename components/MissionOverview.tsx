"use client";

import MissionPlayback from "@/components/MissionPlayback";
import type { PrototypeMission, PrototypeScenario } from "@/lib/henry-prototype";

type Props = {
  mission: PrototypeMission;
  autoPlay: boolean;
  speed: number;
  busy: boolean;
  canGoBack: boolean;
  onOpenCalendar: () => void;
  onBack: () => void;
  onNext: () => void;
  onTogglePlay: () => void;
  onReplay: () => void;
  onSpeedChange: (speed: number) => void;
  onScenario: (scenario: PrototypeScenario) => void;
};

export default function MissionOverview(props: Props) {
  return <MissionPlayback {...props} />;
}
