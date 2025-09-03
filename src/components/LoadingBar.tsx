"use client";

export default function LoadingBar({
  active,
  label,
  percent, // optional: 0..100; if omitted -> indeterminate shimmer
}: { active: boolean; label?: string; percent?: number | null }) {
  if (!active) return null;

  const clamped =
    typeof percent === "number"
      ? Math.max(0, Math.min(100, percent))
      : null;

  const isIndeterminate = clamped === null;

  return (
    <div className="pt-2" aria-live="polite" aria-busy="true">
      {label && (
        <div className="mb-1 flex items-center justify-between text-xs text-white/75">
          <span className="truncate">{label}</span>
          <span className="tabular-nums">{clamped ?? "…"}{clamped !== null ? "%" : ""}</span>
        </div>
      )}

      {/* glassy track */}
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-white/10 progress-glow">
        {/* fill */}
        <div
          className={[
            "absolute inset-y-0 left-0 h-full rounded-full",
            "shadow-[0_0_18px_2px_rgba(88,101,242,.45)]",
            "bg-[linear-gradient(90deg,#7c3aed,#60a5fa,#34d399,#60a5fa,#7c3aed)]",
            isIndeterminate
              ? "indeterminate-anim"
              : "transition-[width] duration-500 ease-out",
            "pulse-soft",
          ].join(" ")}
          style={{
            width: isIndeterminate ? "40%" : `${clamped}%`,
          }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={clamped ?? undefined}
        />
      </div>
    </div>
  );
}
