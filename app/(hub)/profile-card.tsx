"use client";

import { useRef, type ReactNode, type CSSProperties } from "react";
import Link from "next/link";
import { PERMISSIONS, type InvestingProfile } from "@/lib/socialtrading/profile";
import type { LearnedInterest } from "@/lib/socialtrading/types";
import { Card } from "../_components/ui";
import { gsap, useGSAP, rubiconMotion } from "../_components/motion";
import { badgePalette, isThemeId, THEMES, type ThemeId } from "@/lib/socialtrading/themes";
import { avatarTraits } from "@/lib/socialtrading/avatar";
import { ProfileAvatar } from "./profile-avatar";

export const money = (value: string) => value && Number.isFinite(Number(value))
  ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(Number(value))
  : "—";

function ProfileDetail({ label, value, children }: { label: string; value: string; children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const previous = useRef<string | null>(null);
  useGSAP(() => {
    if (previous.current === value) return;
    const firstReveal = previous.current === null;
    previous.current = value;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      // Debounce typing so the card never pulses for every keystroke.
      gsap.fromTo(root.current, { opacity: firstReveal ? 0 : .65, y: firstReveal ? 6 : 3, ...(firstReveal ? { height: 0 } : {}) }, {
        opacity: 1, y: 0, ...(firstReveal ? { height: "auto" } : {}), duration: .35, delay: firstReveal ? 0 : .15, immediateRender: false,
        ease: rubiconMotion.ease.enter, clearProps: "all",
      });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [value], revertOnUpdate: true });
  return <div ref={root} className="socialtrading-profile-detail"><dt>{label}</dt><dd>{children}</dd></div>;
}

/** Themes the agent has inferred with enough confidence to tint the badge. */
export function learnedThemes(inferred: LearnedInterest[] = [], explicit: ThemeId[] = []): ThemeId[] {
  return inferred.filter(i => isThemeId(i.id) && i.weight > .3 && i.confidence >= .4 && !explicit.includes(i.id as ThemeId)).map(i => i.id as ThemeId);
}

export function ProfileCard({ profile, name, agentName, inferred = [], compact = false, highlight }: {
  profile: InvestingProfile; name?: string; agentName?: string; inferred?: LearnedInterest[];
  /** Hub mode: the card is the persistent anchor beside the conversation. */
  compact?: boolean;
  /** Timestamp of the latest agent-driven change; pulses the card once. */
  highlight?: number;
}) {
  const root = useRef<HTMLElement>(null);
  const final = profile.step === 5;
  const themes = THEMES.filter(t => profile.themes.includes(t.id));
  const learned = learnedThemes(inferred, profile.themes);
  const palette = badgePalette(profile.themes, avatarTraits(profile.userId).color, learned);
  const identity = themes.length ? themes.map(t => t.name).join(" × ") : "Your agent is learning you";
  const learnedAssets = inferred.filter(i => !isThemeId(i.id) && i.weight > .25 && i.confidence >= .4).sort((a, b) => b.weight * b.confidence - a.weight * a.confidence).slice(0, 4);
  const status = compact ? (learned.length || learnedAssets.length ? `Learning · ${[...learned.map(t => THEMES.find(x => x.id === t)!.name), ...learnedAssets.map(a => a.id)].slice(0, 3).join(", ")}` : "Learning from how you explore")
    : final ? "Ready to explore your world" : profile.permissionConfigured ? "Your rules are in place" : profile.interests.length ? `${profile.interests.length} interests bringing it into focus` : themes.length ? `${themes.length} themes shaping your agent` : profile.thesis.trim() ? "Your point of view is taking shape" : "Start with what you believe";

  useGSAP(() => {
    if (!final) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo("[data-profile-reveal]", { y: 7, opacity: .6, scale: .99 }, {
        y: 0, opacity: 1, scale: 1, duration: .42, stagger: .035,
        ease: rubiconMotion.ease.enter, clearProps: "all",
      });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [final], revertOnUpdate: true });

  useGSAP(() => {
    if (!highlight || !root.current) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(root.current!.firstElementChild, { boxShadow: "0 0 0 0 var(--profile-accent)" }, {
        boxShadow: "0 0 0 6px transparent", duration: .9, ease: rubiconMotion.ease.state, clearProps: "boxShadow",
      });
    });
    return () => media.revert();
  }, { dependencies: [highlight] });

  return (
    <aside ref={root} className={`socialtrading-profile${compact ? " is-compact" : ""}`} aria-label="Your live agent profile">
      <Card className={`socialtrading-profile-card${final ? " is-complete" : ""}`} style={{ "--profile-tint": palette.light, "--profile-accent": palette.color } as CSSProperties}>
        <div className="socialtrading-profile-identity" data-profile-reveal>
          <ProfileAvatar seed={profile.userId} themes={profile.themes} inferred={learned} />
          <h2>{agentName ?? (name ? `${name}’s agent` : "Your agent")}</h2>
          <p key={identity}>{identity}</p>
        </div>
        <dl className="socialtrading-profile-details" data-profile-reveal>
          <ProfileDetail label="Your point of view" value={profile.thesis}>
            <p className={`socialtrading-profile-thesis${!profile.thesis.trim() ? " is-empty" : ""}`}>
              {profile.thesis.trim() || "No thesis yet"}
            </p>
          </ProfileDetail>
          {(themes.length > 0 || profile.step > 2) && <ProfileDetail label="Core interests" value={[...profile.themes, "|", ...learned].join(",")}>
            {themes.length || learned.length ? <div className="socialtrading-profile-interests socialtrading-profile-themes">
              {themes.map(theme => <span key={theme.id} style={{ color: theme.dark, background: theme.light }}>{theme.name}</span>)}
              {learned.map(id => { const theme = THEMES.find(t => t.id === id)!; return <span key={id} className="is-learned" style={{ color: theme.dark }} title="Inferred from your activity">{theme.name}</span>; })}
            </div> : <span className="is-empty">Keeping an open mind</span>}
          </ProfileDetail>}
          {(profile.step >= 3 || profile.interests.length > 0) && <ProfileDetail label="Paying attention to" value={profile.interests.map(i => i.id).join(",")}>
            {profile.interests.length ? <div className="socialtrading-profile-interests">{profile.interests.map(i => <span key={i.id} data-interest={i.id}>{i.symbol || i.name}</span>)}</div> : <span className="is-empty">0 assets</span>}
          </ProfileDetail>}
          {compact && learnedAssets.length > 0 && <ProfileDetail label="Noticed you exploring" value={learnedAssets.map(a => a.id).join(",")}>
            <div className="socialtrading-profile-interests">{learnedAssets.map(a => <span key={a.id} className="is-learned">{a.id}</span>)}</div>
          </ProfileDetail>}
          {(profile.step >= 4 || profile.permissionConfigured) && <ProfileDetail label="Agent mode" value={profile.permissionConfigured ? profile.permission : "unconfigured"}>
            <span className={!profile.permissionConfigured ? "is-empty" : undefined}>{profile.permissionConfigured ? PERMISSIONS[profile.permission] : "Permissions not configured"}</span>
          </ProfileDetail>}
          {profile.permissionConfigured && profile.permission === "automatic" && <ProfileDetail label="Your limits · USD" value={JSON.stringify(profile.limits)}>
            <div className="socialtrading-profile-limits">
              <span>{money(profile.limits.perTrade)} per trade</span>
              <span>{money(profile.limits.daily)} daily</span>
              <span>{money(profile.limits.weekly)} weekly</span>
            </div>
          </ProfileDetail>}
        </dl>
        <div className="socialtrading-profile-foot" data-profile-reveal>
          <span className="socialtrading-status-dot" />{status}
          {compact && <Link href="/profile" className="socialtrading-profile-more">Full profile</Link>}
        </div>
      </Card>
    </aside>
  );
}
