"use client";

import type { ReactNode } from "react";

export function ChartFrame({ children, height, className = "" }: { children: ReactNode; height: number | string; className?: string }) {
  return <div className={`dashboard-data-viz w-full select-none ${className}`} style={{ height }} data-chart-frame>{children}</div>;
}

export function ChartTooltip({ label, value, detail }: { label: ReactNode; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="rubicon-hover-surface min-w-40 px-3 py-2.5 text-left">
      <div className="text-xs text-white/75">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-white">{value}</div>
      {detail && <div className="dashboard-meta mt-1">{detail}</div>}
    </div>
  );
}
