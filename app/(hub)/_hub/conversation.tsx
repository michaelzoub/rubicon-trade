"use client";

import { DecisionSurface } from "./worldview";
import { ArrowUp, ChevronDown, MessageSquarePlus, Square, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Message } from "@/lib/socialtrading/types";
import { limitStatus } from "@/lib/socialtrading/plans";
import { ProfileAvatar } from "../profile-avatar";
import { learnedThemes } from "../profile-card";
import { clock, timeAgo } from "./format";
import { messageGloss, useGloss } from "./gloss";
import { useHub } from "./hub-provider";
import { HubLink as Link } from "./navigation";
import { LimitHint, UsagePill } from "./limits-ui";
import { PartView } from "./parts";
import { gsap, useGSAP } from "../../_components/motion";
import "./conversation.css";

const STARTERS = [
  { title: "Turn an idea into a plan", text: "I believe AI will change how we work. Help me explore investments connected to that idea and explain the risks in plain English." },
  { title: "Give my agent a mission", text: "Help me set up an agent to watch the companies I care about. What should it look for, and when should it tell me?" },
  { title: "Start small, understand first", text: "Walk me through how I could start investing with $100, what I could lose, and what I should understand before buying." },
  { title: "Decide what I delegate", text: "What can a trading agent do for me, what needs my approval, and how do I stay in control?" },
];

function Row({ message, name, agentName, seed, themes, learned, profile }: { profile: Parameters<typeof ProfileAvatar>[0]["profile"]; message: Message; name?: string; agentName?: string; seed: string; themes: Parameters<typeof ProfileAvatar>[0]["themes"]; learned: Parameters<typeof ProfileAvatar>[0]["inferred"] }) {
  const { state } = useHub();
  const gloss = useGloss();
  const user = message.role === "user";
  const streaming = message.status === "streaming";
  const empty = message.parts.length === 0;
  const root = useRef<HTMLLIElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".hub-row-body", { opacity: 0, y: 14, x: user ? 12 : -8, scale: .985 }, {
        opacity: 1, y: 0, x: 0, scale: 1, duration: .55, ease: "back.out(1.15)", clearProps: "all",
      });
      gsap.fromTo(".hub-row-avatar", { scale: .7, rotation: -12 }, { scale: 1, rotation: 0, duration: .7, ease: "elastic.out(1, .65)", clearProps: "all" });
    });
    return () => media.revert();
  }, { scope: root });
  useGSAP(() => {
    if (!streaming) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.to(".hub-row-badge", { y: -3, rotation: 4, duration: .9, repeat: -1, yoyo: true, ease: "sine.inOut" });
      gsap.to(".hub-thinking-dot", { y: -5, scale: 1.2, opacity: 1, duration: .4, stagger: .13, repeat: -1, yoyo: true, ease: "sine.inOut" });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [streaming, empty], revertOnUpdate: true });
  // Reaching for what the agent said reveals the belief underneath it.
  const said = message.parts.map(part => "text" in part ? part.text : "").join(" ");
  const why = user || streaming ? null : messageGloss(said, state);
  return (
    <li ref={root} className={`hub-row is-${message.role}${streaming ? " is-streaming" : ""}`} data-message={message.id}>
      {!user && <span className="hub-row-avatar" aria-hidden="true"><ProfileAvatar profile={profile} seed={seed} themes={themes} inferred={learned} className="hub-row-badge" /></span>}
      <div className="hub-row-body">
        <p className="hub-row-meta"><span>{user ? "You" : agentName ?? (name ? `${name}’s agent` : "Your agent")}</span><time dateTime={message.at}>{clock(message.at)}</time>{message.via === "background" && <em className="hub-row-via">Reached out</em>}</p>
        <div className="hub-row-content">
          {message.parts.map((part, i) => <PartView key={i} part={part} />)}
          {streaming && empty && <p className="hub-thinking" role="status" aria-live="polite"><span className="hub-thinking-dots" aria-hidden="true"><i className="hub-thinking-dot" /><i className="hub-thinking-dot" /><i className="hub-thinking-dot" /></span><small>Connecting the dots</small></p>}
          {streaming && !empty && <span className="hub-caret" aria-hidden="true" />}
        </div>
        {why && <button type="button" className="hub-why-trigger" {...gloss(why)}>Why you’re seeing this</button>}
      </div>
    </li>
  );
}

/** Thread header: current chat, the list of others, a new one. The count only appears when it starts to matter. */
function ChatHead() {
  const { chats, chat, selectChat, newChat, deleteChat, account, busy } = useHub();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setConfirm(null); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const limits = account?.limits, used = account?.usage.chats ?? chats.length;
  const status = limits ? limitStatus(limits, "chats", used) : null;
  const ordered = [...chats].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  const canCreate = !busy && !(status?.atLimit);
  return <div ref={root} className="hub-chat-head">
    <button type="button" className="hub-chat-title" aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(o => !o)} data-tooltip="Switch chat">
      <span>{chat.title}</span><ChevronDown size={13} aria-hidden="true" />
    </button>
    <div className="hub-chat-tools">
      {limits && <UsagePill limits={limits} limit="chats" used={used} label="chats" />}
      <button type="button" className="hub-chip-button" disabled={!canCreate} onClick={() => void newChat()} data-tooltip={status?.atLimit ? `You have ${status.limit} chats, the most this plan keeps. Delete an old chat to start a new one.` : "Start a new chat"}>
        <MessageSquarePlus size={12} aria-hidden="true" />New chat
      </button>
    </div>
    {open && <div className="hub-chat-list" role="listbox" aria-label="Your chats with this agent">
      {ordered.map(c => <div key={c.id} className={`hub-chat-item${c.id === chat.id ? " is-active" : ""}`}>
        <button type="button" role="option" aria-selected={c.id === chat.id} onClick={() => { selectChat(c.id); setOpen(false); }}>
          <strong>{c.title}</strong><small>{c.messages.length ? `${c.messages.length} message${c.messages.length === 1 ? "" : "s"} · ${timeAgo(c.updatedAt)}` : "Empty"}</small>
        </button>
        <button type="button" className="hub-chat-delete" aria-label={confirm === c.id ? `Confirm deleting ${c.title}` : `Delete ${c.title}`} aria-pressed={confirm === c.id} disabled={busy}
          onClick={() => { if (confirm === c.id) { setConfirm(null); void deleteChat(c.id); } else setConfirm(c.id); }} data-tooltip={confirm === c.id ? "Click again to delete" : "Delete this chat"}>
          <Trash2 size={13} aria-hidden="true" />
        </button>
      </div>)}
      {limits && <div className="hub-chat-list-foot">
        <LimitHint limits={limits} limit="chats" used={used}
          near={<>{status!.remaining} chat{status!.remaining === 1 ? "" : "s"} left on the {account!.planName} plan, across all your agents.</>}
          full={<>That’s {status!.limit} chats, the most the {account!.planName} plan keeps across all your agents. Delete one here to start another.</>} />
        {confirm && <small className="hub-empty-inline">Click the bin again to confirm.</small>}
      </div>}
    </div>}
  </div>;
}

export function Conversation() {
  const { messages, send, stop, busy, draft, setDraft, userId, name, state, account, chats, chat } = useHub();
  const section = useRef<HTMLElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [stick, setStick] = useState(true);
  const [decision, setDecision] = useState<string | null>(null);
  const learned = learnedThemes(state.inferred, state.profile.themes);
  const outOfCredits = !!account && account.credits.balanceMicros < account.credits.holdMicros;
  const readyToSend = !!draft.trim() && !busy && !outOfCredits;

  useGSAP(() => {
    if (!readyToSend) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(".hub-send", { scale: .85, rotation: -8 }, { scale: 1, rotation: 0, duration: .5, ease: "back.out(2)", clearProps: "transform" });
    });
    return () => media.revert();
  }, { scope: section, dependencies: [readyToSend], revertOnUpdate: true });

  useLayoutEffect(() => {
    const fit = () => {
      const node = section.current;
      if (!node) return;
      const available = (window.visualViewport?.height ?? window.innerHeight) - node.getBoundingClientRect().top - 16;
      node.style.setProperty("--conversation-height", `${Math.max(280, available)}px`);
    };
    fit();
    window.addEventListener("resize", fit);
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.visualViewport?.removeEventListener("resize", fit);
    };
  }, []);

  useLayoutEffect(() => {
    if (!stick || !list.current) return;
    list.current.scrollTop = messages.length ? list.current.scrollHeight : 0;
  }, [messages, stick]);

  useEffect(() => {
    const node = input.current;
    if (!node) return;
    const fit = () => { node.style.height = "0px"; node.style.height = `${Math.min(node.scrollHeight, 160)}px`; };
    fit();
    // Styles can land after first paint in development; measure once more.
    const frame = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(frame);
  }, [draft]);

  useEffect(() => { setDecision(null); setStick(true); }, [chat.id]);

  useEffect(() => { if (draft && input.current) input.current.focus(); }, [draft]);

  function submit() {
    if (!draft.trim() || busy || outOfCredits) return;
    setStick(true);
    if (/should i|why.*care|what.*means|compare|worth|thesis/i.test(draft)) setDecision(draft.trim());
    void send(draft);
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
  }

  return (
    <section ref={section} className="hub-conversation" aria-label="Conversation with your agent">
      {(chats.length > 1 || messages.length > 0 || account) && <ChatHead />}
      {decision && <DecisionSurface question={decision} onClose={() => setDecision(null)} />}
      <ol hidden={!!decision} ref={list} className="hub-messages" data-agent-region="conversation" data-agent-weight="3" onScroll={e => { const el = e.currentTarget; setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 48); }}>
        {messages.length === 0 && (
          <li key={chat.id} className="hub-welcome">
            <div className="hub-agent-ready"><span />{state.agent?.name ?? "Your agent"} · Ready to explore</div>
            <div className="hub-welcome-presence">
            <ProfileAvatar profile={state.profile} seed={state.agent?.id ?? userId} themes={state.profile.themes} inferred={learned} className="hub-welcome-badge" />
            </div>
            <h1 className="landing-section-title">{name ? `${name}, what’s on your mind?` : "Big ideas. A small first step."}</h1>
            <p>Bring your curiosity. We’ll connect it to the markets, unpack the risks, and decide what your agent should do next.</p>
            <div className="hub-starters hub-query-grid">{STARTERS.map(s => <button key={s.title} type="button" disabled={busy || outOfCredits} onClick={() => { setStick(true); void send(s.text); }}><strong>{s.title}<span aria-hidden="true">↗</span></strong><span>{s.text}</span></button>)}</div>
          </li>
        )}
        {messages.map(message => <Row profile={state.profile} key={message.id} message={message} name={name} agentName={state.agent?.name} seed={state.agent?.id ?? userId} themes={state.profile.themes} learned={learned} />)}
      </ol>
      <form data-agent-region="composer" className={`hub-composer${draft.trim() ? " has-draft" : ""}`} onSubmit={e => { e.preventDefault(); submit(); }}>
        <label htmlFor="hub-composer-input" className="sr-only">Message your agent</label>
        <textarea id="hub-composer-input" ref={input} rows={1} value={draft} maxLength={4000} disabled={outOfCredits} onChange={e => setDraft(e.target.value)} onKeyDown={onKey}
          placeholder={outOfCredits ? "Out of credits" : busy ? "Thinking…" : "Ask about a stock, a theme, or change how I work"} />
        {busy
          ? <button type="button" className="hub-send" onClick={stop} aria-label="Stop"><Square size={13} aria-hidden="true" /></button>
          : <button type="submit" className="hub-send" disabled={!draft.trim() || outOfCredits} aria-label="Send"><ArrowUp size={15} aria-hidden="true" /></button>}
      </form>
      {account && <div className="hub-composer-meta">
        {outOfCredits
          ? <p className="hub-limit-hint is-full" role="status">You’ve used your {account.planName} plan credits, so your agent can’t answer or run checks right now. Everything here is saved. <Link className="hub-inline-link" href="/plans">See plans</Link></p>
          : account.credits.balanceMicros < 500_000 ? <p className="hub-limit-hint" role="status">Credits are running low. Each reply costs what the model charges, usually well under a cent.</p> : <span />}

      </div>}
    </section>
  );
}
