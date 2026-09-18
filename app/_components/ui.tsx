"use client";

import type { CSSProperties, ReactNode } from "react";

export function Card({ children, className = "", id, style }: { children: ReactNode; className?: string; id?: string; style?: CSSProperties }) {
  return (
    <div id={id} style={style} className={`dashboard-card bg-[var(--card)] ${className}`}>
      {children}
    </div>
  );
}

/** A soft, neutral skeleton placeholder with a calm matte shimmer. */
export function Skeleton({ className = "", rounded = "rounded-md" }: { className?: string; rounded?: string }) {
  return <div className={`rubicon-skeleton ${rounded} ${className}`} aria-hidden="true" />;
}

export { AgentLoadingState as LoadingState } from "./agent-loading-state";
