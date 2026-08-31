"use client";

import { useEffect, useRef } from "react";
import { Color, Mesh, Program, Renderer, Triangle } from "ogl";

const MAX_STRANDS = 4;
const MAX_COLORS = 4;

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColors[${MAX_COLORS}];
uniform int uColorCount;
uniform int uStrandCount;
uniform float uSpeed;
uniform float uAmplitude;
uniform float uWaviness;
uniform float uThickness;
uniform float uGlow;
uniform float uOpacity;
out vec4 fragColor;
const float PI = 3.14159265;

vec3 palette(float t) {
  float scaled = fract(t) * float(uColorCount);
  int index = int(floor(scaled));
  int nextIndex = index + 1;
  if (nextIndex >= uColorCount) nextIndex = 0;
  return mix(uColors[index], uColors[nextIndex], fract(scaled));
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uResolution) / uResolution.y;
  float envelope = pow(max(cos(uv.x * PI * 1.15), 0.0), 4.0);
  vec3 color = vec3(0.0);
  for (int i = 0; i < ${MAX_STRANDS}; i++) {
    if (i >= uStrandCount) break;
    float fi = float(i);
    float phase = fi * 1.65;
    float frequency = (2.0 + fi * 0.28) * uWaviness;
    float time = uTime * uSpeed;
    float wave = sin(uv.x * frequency + time * (1.0 + fi * 0.35) + phase) * 0.66
      + sin(uv.x * frequency * 1.15 - time * 0.62 + phase * 1.4) * 0.34;
    float y = wave * 0.095 * envelope * uAmplitude + (fi - 1.0) * 0.025;
    float distanceToLine = abs(uv.y - y);
    float width = (0.001 + 0.012 * envelope) * uThickness;
    float energy = width / (distanceToLine + width * 0.7);
    energy *= energy;
    color += palette(fi / float(uStrandCount) + uv.x * 0.16) * energy * envelope;
  }
  color = 1.0 - exp(-color * uGlow);
  float alpha = clamp(max(max(color.r, color.g), color.b), 0.0, 1.0) * uOpacity;
  fragColor = vec4(color * uOpacity, alpha);
}
`;

type StrandsProps = {
  colors?: string[];
  count?: number;
  speed?: number;
  amplitude?: number;
  waviness?: number;
  thickness?: number;
  glow?: number;
  opacity?: number;
  className?: string;
};

function palette(colors: string[]) {
  const source = colors.length ? colors : ["#a8b69a"];
  return Array.from({ length: MAX_COLORS }, (_, index) => {
    const color = new Color(source[index] ?? source[source.length - 1]);
    return [color.r, color.g, color.b];
  });
}

export default function Strands({
  colors = ["#8fa286", "#c69a7b", "#d4cec1"],
  count = 2,
  speed = .12,
  amplitude = .7,
  waviness = .75,
  thickness = .32,
  glow = 1.25,
  opacity = .14,
  className = "",
}: StrandsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef({ colors, count, speed, amplitude, waviness, thickness, glow, opacity });

  useEffect(() => {
    propsRef.current = { colors, count, speed, amplitude, waviness, thickness, glow, opacity };
  }, [amplitude, colors, count, glow, opacity, speed, thickness, waviness]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const initial = propsRef.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) {
      container.dataset.fallback = "true";
      return;
    }
    const isWebGl2 = typeof WebGL2RenderingContext !== "undefined" && context instanceof WebGL2RenderingContext;
    const renderer = new Renderer({ canvas, webgl: isWebGl2 ? 2 : 1, alpha: true, premultipliedAlpha: true, antialias: false, dpr: Math.min(window.devicePixelRatio, 1.5) });
    const gl = renderer.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) delete geometry.attributes.uv;
    const program = new Program(gl, {
      vertex: VERTEX,
      fragment: FRAGMENT,
      uniforms: {
        uTime: { value: 0 },
        uResolution: { value: [container.clientWidth, container.clientHeight] },
        uColors: { value: palette(initial.colors) },
        uColorCount: { value: Math.min(initial.colors.length, MAX_COLORS) },
        uStrandCount: { value: Math.min(initial.count, MAX_STRANDS) },
        uSpeed: { value: initial.speed },
        uAmplitude: { value: initial.amplitude },
        uWaviness: { value: initial.waviness },
        uThickness: { value: initial.thickness },
        uGlow: { value: initial.glow },
        uOpacity: { value: initial.opacity },
      },
    });
    const mesh = new Mesh(gl, { geometry, program });
    container.appendChild(gl.canvas);

    const resize = () => {
      const width = Math.max(1, container.clientWidth);
      const height = Math.max(1, container.clientHeight);
      renderer.setSize(width, height);
      program.uniforms.uResolution.value = [width, height];
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let frame = 0;
    let visible = true;
    const render = (time: number) => {
      const current = propsRef.current;
      program.uniforms.uTime.value = time * .001;
      program.uniforms.uColors.value = palette(current.colors);
      program.uniforms.uColorCount.value = Math.max(1, Math.min(current.colors.length, MAX_COLORS));
      program.uniforms.uStrandCount.value = Math.max(1, Math.min(Math.round(current.count), MAX_STRANDS));
      program.uniforms.uSpeed.value = current.speed;
      program.uniforms.uAmplitude.value = current.amplitude;
      program.uniforms.uWaviness.value = current.waviness;
      program.uniforms.uThickness.value = current.thickness;
      program.uniforms.uGlow.value = current.glow;
      program.uniforms.uOpacity.value = current.opacity;
      renderer.render({ scene: mesh });
      if (!reducedMotion && visible) frame = requestAnimationFrame(render);
    };
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      const nextVisible = entry.isIntersecting;
      if (nextVisible && !visible && !reducedMotion) frame = requestAnimationFrame(render);
      visible = nextVisible;
    });
    intersectionObserver.observe(container);
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      if (gl.canvas.parentNode === container) container.removeChild(gl.canvas);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return <div ref={containerRef} className={`strands-container ${className}`} aria-hidden="true" />;
}
