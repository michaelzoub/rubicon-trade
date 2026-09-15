"use client";

import type { ReactNode } from "react";

export function ChartFrame({ children, height, className = "" }: { children: ReactNode; height: number | string; className?: string }) {
  return <div className={`dashboard-data-viz w-full select-none ${className}`} style={{ height }} data-chart-frame>{children}</div>;
}

export function ChartTooltip({ label, value, detail }: { label: ReactNode; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="min-w-40 rounded-lg border border-[var(--line)] bg-white px-3 py-2.5 text-left">
      <div className="dashboard-meta">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--ink)]">{value}</div>
      {detail && <div className="dashboard-meta mt-1">{detail}</div>}
    </div>
  );
}
