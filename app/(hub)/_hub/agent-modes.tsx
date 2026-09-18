"use client";

import { useRef, useState } from "react";
import { Bell, Check, MessageSquare, SlidersHorizontal, Wallet } from "lucide-react";
import { PERMISSIONS, type InvestingProfile, type Permission } from "@/lib/socialtrading/profile";
import { gsap, prefersReducedMotion, useGSAP } from "../../_components/motion";

/** The four ways an agent can work with you, as one decision.
 *
 * `buy` is not a fourth permission in the data model — it is `automatic` plus a
 * delegated signer — but it is a fourth *choice* here, because "it can spend
 * without me" is what a person is actually deciding, and burying that in a
 * checkbox somewhere else made it unfindable.
 *
 * The meaning lives here because two places now ask the same question: the
 * profile page, and the dialog that opens when you adjust one agent. They must
 * never drift — this is the most consequential control in the product. */
export type Mode = Permission | "buy";
export const MODES: Mode[] = ["notify", "approve", "automatic", "buy"];
export const MODE_LABEL: Record<Mode, string> = { ...PERMISSIONS, buy: "Buy for me" };
export const MODE_LINE: Record<Mode, string> = {
  notify: "It tells you what it sees. Every buy is yours to make.",
  approve: "It brings you ideas and proposes trades. Nothing moves until you say so.",
  automatic: "It proposes inside a comfort zone you set. You still sign every one.",
  buy: "It buys inside your comfort zone while you are away, on Base, using your USDC.",
};
export const MODE_ICONS = { notify: Bell, approve: MessageSquare, automatic: SlidersHorizontal, buy: Wallet };

/** The mode a draft profile is expressing, which is not the same as its stored permission. */
export const modeOf = (profile: Pick<InvestingProfile, "permission" | "autoExecute">): Mode =>
  profile.autoExecute && profile.permission === "automatic" ? "buy" : profile.permission;

/** Applies a chosen mode back onto a profile draft. Choosing anything but `buy`
 * is also how you stop it spending, so `autoExecute` always follows. */
export const withMode = <T extends InvestingProfile>(profile: T, value: Mode): T => ({
  ...profile,
  permissionConfigured: true,
  permission: value === "buy" ? "automatic" : value,
  autoExecute: value === "buy",
});

/**
 * Four tiles and one line.
 *
 * The tiles carry a name and nothing else, so the choice can be read at a
 * glance; the sentence underneath belongs to whichever tile the pointer is on,
 * falling back to the chosen one. Each tile wears the same drawn edge the
 * account menu uses, and they draw themselves once when the dialog opens — the
 * one moment where saying "these are the four, and they are yours to pick" is
 * worth a second of motion.
 */
export function ModeTiles({ mode, onChange, disabled = false }: { mode: Mode; onChange: (value: Mode) => void; disabled?: boolean }) {
  const [hovered, setHovered] = useState<Mode | null>(null);
  const grid = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    const tiles = gsap.utils.toArray<HTMLElement>("[data-mode]", grid.current);
    if (!tiles.length || prefersReducedMotion()) return;
    const timeline = gsap.timeline()
      .fromTo(tiles, { opacity: 0, y: 5 }, { opacity: 1, y: 0, duration: .32, stagger: .05, ease: "power2.out" })
      .fromTo(tiles, { "--edge-angle": "0deg" }, { "--edge-angle": "360deg", duration: 1.1, stagger: .07, ease: "power2.inOut" }, 0);
    return () => { timeline.kill(); };
  }, { scope: grid });

  const said = hovered ?? mode;
  return <div className="hub-modetiles">
    <div ref={grid} className="hub-modetiles-grid" role="radiogroup" aria-label="How far it can go">
      {MODES.map(value => {
        const Icon = MODE_ICONS[value], selected = mode === value;
        return <label key={value} data-mode={value} className={`hub-modetile${selected ? " is-selected" : ""}`}
          onPointerEnter={() => setHovered(value)} onPointerLeave={() => setHovered(null)}>
          <input type="radio" name="agent-mode" value={value} checked={selected} disabled={disabled}
            onChange={() => onChange(value)} onFocus={() => setHovered(value)} onBlur={() => setHovered(null)} />
          <span className="hub-modetile-icon" aria-hidden="true"><Icon size={16} strokeWidth={1.7} /></span>
          <span className="hub-modetile-name">{MODE_LABEL[value]}</span>
          <span className="hub-modetile-check" aria-hidden="true">{selected && <Check size={11} strokeWidth={3} />}</span>
        </label>;
      })}
    </div>
    <p className="hub-modetiles-say" aria-live="polite">{MODE_LINE[said]}</p>
  </div>;
}

/** Per-trade, per-day, per-week caps in USD. Three numbers, no preamble. */
export function ComfortZoneFields({ limits, onChange }: { limits: InvestingProfile["limits"]; onChange: (limits: InvestingProfile["limits"]) => void }) {
  return <div className="hub-zonefields">
    {([["perTrade", "Per trade"], ["daily", "Per day"], ["weekly", "Per week"]] as const).map(([key, label]) =>
      <label key={key}>
        <span>{label}</span>
        <span className="hub-zonefield-input">
          <i aria-hidden="true">$</i>
          <input type="number" inputMode="decimal" min="0.01" step="0.01" value={limits[key]} placeholder="0"
            onChange={e => onChange({ ...limits, [key]: e.target.value })} />
        </span>
      </label>)}
  </div>;
}

/** The profile page's larger, self-explaining cards. Same four choices, room to read. */
export function ModeChooser({ mode, onChange }: { mode: Mode; onChange: (value: Mode) => void }) {
  return <fieldset className="hub-modes">
    <legend className="sr-only">How your agent works with you</legend>
    {MODES.map(value => {
      const Icon = MODE_ICONS[value], selected = mode === value;
      return <label key={value} className={`hub-mode${selected ? " is-selected" : ""}`}>
        <input type="radio" name="permission" value={value} checked={selected} onChange={() => onChange(value)} />
        <span className="hub-mode-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.6} /></span>
        <span className="hub-mode-copy"><strong>{MODE_LABEL[value]}</strong><small>{MODE_LINE[value]}</small></span>
        <span className="hub-mode-check" aria-hidden="true">{selected && <Check size={12} />}</span>
      </label>;
    })}
  </fieldset>;
}

/** The profile page's comfort zone, with its heading and caption. */
export function ComfortZone({ limits, required, onChange }: { limits: InvestingProfile["limits"]; required: boolean; onChange: (limits: InvestingProfile["limits"]) => void }) {
  return <div className="hub-field hub-zone">
    <div className="hub-field-head"><p>{required ? "Comfort zone · USD" : "Comfort zone · USD (optional)"}</p></div>
    <div className="hub-zone-fields">
      {([["perTrade", "Per trade"], ["daily", "Per day"], ["weekly", "Per week"]] as const).map(([key, label]) =>
        <label key={key} className="hub-zone-field">
          <span>{label}</span>
          <span className="hub-zone-input">
            <i aria-hidden="true">$</i>
            <input className="socialtrading-input" type="number" inputMode="decimal" min="0.01" step="0.01" value={limits[key]} placeholder="0"
              onChange={e => onChange({ ...limits, [key]: e.target.value })} />
          </span>
        </label>)}
    </div>
    <p className="socialtrading-caption">Your agent stays inside these; trades you place yourself don’t count. Checked on the server before anything is quoted.</p>
  </div>;
}
