"use client";

import { Bell, Check, MessageSquare, SlidersHorizontal } from "lucide-react";
import { PERMISSIONS, type Limits, type Permission } from "@/lib/socialtrading/profile";

const ICONS = { notify: Bell, approve: MessageSquare, automatic: SlidersHorizontal };
const BLURBS: Record<Permission, string> = {
  notify: "It watches. You decide when to move.",
  approve: "It prepares the trade. You approve.",
  automatic: "It trades, up to limits you set.",
};

/** The last beat: a one-line portrait, then how the agent is allowed to act. */
export function OnboardingRules({ portrait, permission, configured, limits, onPermission, onLimit }: {
  portrait: string;
  permission: Permission;
  configured: boolean;
  limits: Limits;
  onPermission: (value: Permission) => void;
  onLimit: (key: keyof Limits, value: string) => void;
}) {
  return <div className="onb-rules">
    <p className="onb-portrait">
      <span className="onb-portrait-kicker">In short</span>
      <strong className="onb-portrait-line">{portrait}</strong>
    </p>
    <fieldset className="onb-permissions">
      <legend>How should your agent act?</legend>
      {(Object.entries(PERMISSIONS) as [Permission, string][]).map(([value, label]) => {
        const Icon = ICONS[value];
        const selected = configured && permission === value;
        return <label key={value} className="onb-option">
          <input type="radio" name="permission" value={value} checked={selected} onChange={() => onPermission(value)} />
          <span className="onb-option-icon" aria-hidden="true"><Icon size={18} strokeWidth={1.7} /></span>
          <span className="onb-option-copy"><strong>{label}</strong><span>{BLURBS[value]}</span></span>
          <span className="onb-check" aria-hidden="true">{selected && <Check size={12} />}</span>
        </label>;
      })}
    </fieldset>
    {configured && permission === "automatic" && <div className="onb-limits">
      {([["perTrade", "Per trade"], ["daily", "Daily"], ["weekly", "Weekly"]] as const).map(([key, label]) =>
        <label key={key}>{label}<input type="number" inputMode="decimal" min="0.01" step="0.01" value={limits[key]} onChange={e => onLimit(key, e.target.value)} /></label>)}
    </div>}
  </div>;
}
