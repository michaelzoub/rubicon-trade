"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Interest } from "@/lib/socialtrading/profile";

type Recommendation = { id: string; name: string; symbol?: string; reason: string };
const cache = new Map<string, Recommendation[]>();

export function InterestPreview({ interest, onRemove }: { interest: Interest; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Recommendation[] | null>(null);
  const [failed, setFailed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  useEffect(() => {
    if (!open) return;
    const key = new URLSearchParams({ id: interest.id, name: interest.name }).toString();
    const cached = cache.get(key);
    if (cached) { setItems(cached); return; }
    const controller = new AbortController();
    setFailed(false);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/trade/interests?${key}`, { signal: controller.signal });
        if (!response.ok) throw new Error("Preview unavailable");
        const data = await response.json();
        if (controller.signal.aborted) return;
        cache.set(key, data.recommendations);
        setItems(data.recommendations);
      } catch { if (!controller.signal.aborted) setFailed(true); }
    }, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [open, interest.id, interest.name]);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return <div ref={root} className="interest-preview" data-interest={interest.id}
    onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}>
    <div className="interest-preview-chip">
      <button type="button" className="button button-secondary" aria-expanded={open} aria-controls={panelId}
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)}>{interest.symbol || interest.name}</button>
      <button type="button" className="interest-preview-remove" aria-label={`Remove ${interest.name}`} onClick={onRemove}><X size={12} aria-hidden="true" /></button>
    </div>
    {open && <div id={panelId} className="interest-preview-panel" role="region" aria-label={`Related to ${interest.name}`}>
      <p className="interest-preview-title">Worth exploring</p>
      <div role="status">
        {failed ? <p>Preview unavailable. Try hovering again.</p> : items === null ? <p>Finding related assets…</p> : items.length === 0 ? <p>No related assets in our catalog yet. Your interest is still saved.</p> : items.map(item => <div className="interest-preview-item" key={item.id}>
          <strong>{item.symbol}</strong><span>{item.name}</span><small>{item.reason}</small>
        </div>)}
      </div>
      <p className="interest-preview-note">Examples connected to your interest. Nothing is added to your watchlist.</p>
    </div>}
  </div>;
}
