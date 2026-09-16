"use client";

import { useEffect, useId, useRef, useState } from "react";
import { isThemeId, THEMES } from "@/lib/socialtrading/themes";
import { ProfileAvatar } from "../profile-avatar";
import { learnedThemes, ProfileCard } from "../profile-card";
import { useHub } from "./hub-provider";
import { HubLink as Link } from "./navigation";

/** What the agent is doing, said in words rather than shown as a dashboard.
 * Watched names come first because they are the thing the person chose; what
 * the agent picked up on its own is the fallback, and it says so. */
export function presenceStatus(
  interests: { symbol?: string; name: string }[],
  learned: string[],
): string {
  const names = interests.map(i => i.symbol || i.name).filter(Boolean);
  if (names.length) {
    const shown = names.slice(0, 3).join(", ");
    return names.length > 3 ? `Watching ${shown} and ${names.length - 3} more` : `Watching ${shown}`;
  }
  if (learned.length) return `Learning from how you explore · ${learned.slice(0, 2).join(", ")}`;
  return "Getting to know you";
}

/** The agent's standing presence on the pages that are about something else.
 * The pill says the one thing worth knowing at a glance; hovering it reveals
 * the full profile card that used to occupy the right rail, so the detail is
 * one gesture away instead of permanently in the way. */
export function AgentPresence({ resolveHref = (href: string) => href }: { resolveHref?: (href: string) => string }) {
  const { state, name } = useHub();
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);

  const change = (value: boolean) => {
    if (closing.current) { clearTimeout(closing.current); closing.current = null; }
    setOpen(value);
  };
  // A short grace on leave so the cursor can cross from the pill to the card.
  const leave = () => { closing.current = setTimeout(() => change(false), 140); };
  useEffect(() => () => { if (closing.current) clearTimeout(closing.current); }, []);

  const learnedIds = learnedThemes(state.inferred, state.profile.themes);
  const learned = [
    ...learnedIds.map(id => THEMES.find(t => t.id === id)?.name ?? id),
    ...state.inferred.filter(i => !isThemeId(i.id) && i.weight > .25 && i.confidence >= .4).map(i => i.id),
  ];
  const agentName = state.agent?.name ?? (name ? `${name}’s agent` : "Your agent");
  const awake = state.agent?.enabled !== false;
  const status = presenceStatus(state.profile.interests, learned);

  return (
    <div ref={root} className={`hub-presence-anchor${open ? " is-open" : ""}`}
      onMouseEnter={() => change(true)} onMouseLeave={leave}
      onFocus={() => change(true)}
      onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node | null)) change(false); }}
      // Focus returns to the pill before closing, so the focus event cannot reopen the card.
      onKeyDown={event => { if (event.key === "Escape" && open) { trigger.current?.focus(); change(false); } }}>
      <Link ref={trigger} href={resolveHref("/agents")} className={`hub-presence${awake ? " is-awake" : ""}`}
        aria-describedby={open ? id : undefined}
        aria-label={`${agentName}. ${status}. Open your agents.`}>
        <ProfileAvatar profile={state.profile} seed={state.agent?.id ?? state.profile.userId} themes={state.profile.themes} inferred={learnedIds} className="hub-presence-badge" />
        <span className="hub-presence-copy">
          <strong>{agentName}</strong>
          <span className="hub-presence-status">{status}</span>
        </span>
        <span className="hub-presence-dot" aria-hidden="true" />
      </Link>
      {/* The blur is inline on purpose. Next’s CSS minifier rewrites a
        * stylesheet `backdrop-filter` to the `-webkit-` form only, which some
        * engines reject outright, so a glass surface declared in CSS silently
        * loses its blur. Inline styles are not put through that rewrite. */}
      <span className="hub-presence-scrim" aria-hidden="true" hidden={!open}
        style={{ backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)" }} />
      <div id={id} className="hub-presence-card" hidden={!open}>
        <ProfileCard profile={state.profile} name={name} agentName={state.agent?.name} avatarSeed={state.agent?.id} inferred={state.inferred} compact />
      </div>
    </div>
  );
}
