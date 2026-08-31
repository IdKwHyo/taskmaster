"use client";

import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Icosahedron, MeshDistortMaterial } from "@react-three/drei";
import type { Group } from "three";
import type { MissionStatus } from "@/lib/henry-prototype";
import type { MissionTwinState } from "@/lib/mission-twin";

type Props = {
  status: MissionStatus;
  twinState: MissionTwinState;
  paused: boolean;
  speaking: boolean;
};

const CORE_STATES = {
  running: { color: "#9caf88", emissive: "#d9b99b", speed: 1.25, distort: .23, opacity: .32 },
  planning: { color: "#91a681", emissive: "#d7b799", speed: 1.7, distort: .3, opacity: .38 },
  waiting: { color: "#b99a82", emissive: "#e6c9ad", speed: .34, distort: .12, opacity: .27 },
  approval: { color: "#bd8d51", emissive: "#e4c07d", speed: .18, distort: .09, opacity: .4 },
  recovery: { color: "#b98263", emissive: "#dfb99f", speed: 1.9, distort: .31, opacity: .4 },
  complete: { color: "#819876", emissive: "#c8d7bb", speed: .22, distort: .08, opacity: .3 },
  cancelled: { color: "#a98078", emissive: "#d7b7ad", speed: .08, distort: .05, opacity: .22 },
  speaking: { color: "#8fa47f", emissive: "#d9b99b", speed: 1.65, distort: .27, opacity: .4 },
} as const;

type CoreState = keyof typeof CORE_STATES;

function stateFor({ status, twinState, paused, speaking }: Props): CoreState {
  if (speaking) return "speaking";
  if (paused || status === "WAITING_EXTERNAL") return "waiting";
  if (status === "NEEDS_APPROVAL") return "approval";
  if (status === "COMPLETED") return "complete";
  if (status === "CANCELLED" || status === "FAILED") return "cancelled";
  if (twinState === "FALLBACK") return "recovery";
  if (twinState === "SIMULATED") return "planning";
  return "running";
}

function AgentCore({ coreState, reducedMotion }: { coreState: CoreState; reducedMotion: boolean }) {
  const group = useRef<Group>(null);
  const target = useRef({ x: 0, y: 0 });
  const state = CORE_STATES[coreState];

  useEffect(() => {
    if (reducedMotion) return;
    const onPointerMove = (event: PointerEvent) => {
      target.current.x = (event.clientY / window.innerHeight - 0.5) * 0.28;
      target.current.y = (event.clientX / window.innerWidth - 0.5) * 0.38;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [reducedMotion]);

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    if (reducedMotion) {
      group.current.rotation.set(0, 0, 0);
      group.current.scale.setScalar(1);
      return;
    }
    group.current.rotation.x += (target.current.x - group.current.rotation.x) * Math.min(delta * 2.5, 1);
    group.current.rotation.y += (target.current.y - group.current.rotation.y) * Math.min(delta * 2.5, 1);
    const breath = coreState === "waiting" || coreState === "approval" ? .012 : .022;
    const targetScale = 1 + Math.sin(clock.elapsedTime * (coreState === "speaking" ? 2.4 : .72)) * breath;
    group.current.scale.setScalar(targetScale);
  });

  return (
    <group ref={group}>
      <Float speed={reducedMotion ? 0 : coreState === "waiting" ? .45 : 1.05} rotationIntensity={reducedMotion ? 0 : coreState === "approval" ? .04 : .18} floatIntensity={reducedMotion ? 0 : coreState === "approval" ? .12 : .4}>
        <Icosahedron args={[1.78, 2]}>
          <MeshDistortMaterial
            color={state.color}
            emissive={state.emissive}
            emissiveIntensity={coreState === "approval" || coreState === "speaking" ? .38 : .24}
            roughness={0.82}
            metalness={0.08}
            distort={reducedMotion ? .04 : state.distort}
            speed={reducedMotion ? 0 : state.speed}
            wireframe
            transparent
            opacity={state.opacity}
          />
        </Icosahedron>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[2.04, .006, 4, 72]} />
          <meshBasicMaterial color={state.color} transparent opacity={coreState === "approval" ? .34 : .13} />
        </mesh>
        <mesh rotation={[Math.PI / 2.8, .42, .18]}>
          <torusGeometry args={[2.2, .004, 4, 72]} />
          <meshBasicMaterial color={state.emissive} transparent opacity={coreState === "recovery" ? .3 : .1} />
        </mesh>
      </Float>
    </group>
  );
}

export default function HenryCore3D(props: Props) {
  const [webglAvailable, setWebglAvailable] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const coreState = stateFor(props);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    const supported = Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    const frame = window.requestAnimationFrame(() => setWebglAvailable(supported));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    media.addEventListener("change", updatePreference);
    return () => media.removeEventListener("change", updatePreference);
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 opacity-70" aria-hidden="true">
      {webglAvailable ? (
        <Canvas frameloop={reducedMotion ? "demand" : "always"} dpr={[1, 1.35]} camera={{ position: [0, 0, 6], fov: 44 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
          <ambientLight intensity={0.32} />
          <pointLight position={[4, 2, 4]} color="#d9b99b" intensity={5} distance={10} />
          <AgentCore coreState={coreState} reducedMotion={reducedMotion} />
        </Canvas>
      ) : <div className={`ambient-core-fallback state-${coreState}`} />}
    </div>
  );
}
