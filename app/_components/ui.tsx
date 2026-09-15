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

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="dashboard-card grid gap-5 bg-[var(--card)] p-4" aria-label={label} role="status">
      <span className="sr-only">{label}</span>
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-8 w-24" rounded="rounded-lg" />
      </div>
      <div className="grid gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="flex items-center justify-between gap-5 rounded-lg bg-[var(--surface-muted)] px-3 py-2.5">
            <div className="grid flex-1 gap-2">
              <Skeleton className={`h-3.5 ${index % 2 === 0 ? "w-2/5" : "w-1/3"}`} />
              <Skeleton className={`h-3 ${index % 2 === 0 ? "w-3/5" : "w-1/2"}`} />
            </div>
            <Skeleton className="h-6 w-16" rounded="rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
