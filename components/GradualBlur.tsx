"use client";

type GradualBlurProps = {
  divCount?: number;
  height?: string;
  position?: "top" | "bottom";
  strength?: number;
  zIndex?: number;
};

export default function GradualBlur({
  divCount = 6,
  height = "8rem",
  position = "bottom",
  strength = 2,
  zIndex = 50,
}: GradualBlurProps) {
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 ${position === "top" ? "top-0" : "bottom-0"}`}
      style={{ height, zIndex }}
      aria-hidden="true"
    >
      {Array.from({ length: divCount }).map((_, index) => {
        const progress = (index + 1) / divCount;
        const visualIndex = position === "bottom" ? index : divCount - 1 - index;
        return (
          <div
            key={index}
            className="absolute inset-x-0"
            style={{
              height: `${100 / divCount + 14}%`,
              [position]: `${(visualIndex * 100) / divCount}%`,
              backdropFilter: `blur(${Math.pow(progress, 1.8) * strength * 5}px)`,
              WebkitBackdropFilter: `blur(${Math.pow(progress, 1.8) * strength * 5}px)`,
              maskImage: "linear-gradient(to bottom, transparent, black 35%, black 65%, transparent)",
              WebkitMaskImage: "linear-gradient(to bottom, transparent, black 35%, black 65%, transparent)",
            }}
          />
        );
      })}
    </div>
  );
}
