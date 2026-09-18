"use client";
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { SellPanel } from './sell-panel';
import { BuyPanel } from './buy-panel';
import type { PurchaseRequest } from './purchase';
import { gsap } from '../../_components/motion';

export function PurchaseDialog() {
  const [request, setRequest] = useState<PurchaseRequest | null>(null);
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [session, setSession] = useState(0);
  /** What the panel is actually buying, which need not be what opened it. */
  const [chosen, setChosen] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const open = (event: Event) => {
      origin.current = document.activeElement as HTMLElement;
      setRequest((event as CustomEvent<PurchaseRequest>).detail);
      setChosen(null);
      setSide((event as CustomEvent<PurchaseRequest>).detail.side ?? "buy");
      setSession(n => n + 1);
    };
    window.addEventListener('rubicon:purchase', open);
    return () => window.removeEventListener('rubicon:purchase', open);
  }, []);
  useEffect(() => {
    if (!request || !dialog.current) return;
    // Keep wallet-provider portals interactive above this focused surface.
    dialog.current.show();
    dialog.current.querySelector<HTMLButtonElement>('button')?.focus();
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => { document.body.style.overflow = overflow; };
    const tween = gsap.fromTo(dialog.current, { opacity: 0, y: 18, scale: .97 }, { opacity: 1, y: 0, scale: 1, duration: .4, ease: 'power3.out' });
    return () => { tween.kill(); document.body.style.overflow = overflow; };
  }, [request, session]);
  function close() {
    dialog.current?.close(); setRequest(null); setChosen(null);
    const trigger = origin.current;
    if (trigger?.isConnected && !trigger.matches(':disabled')) trigger.focus();
    else document.querySelector<HTMLTextAreaElement>('.hub-composer textarea, .ambient-panel textarea')?.focus();
  }
  return <div className="purchase-backdrop" hidden={!request} onClick={e => { if (e.target === e.currentTarget) close(); }}><dialog ref={dialog} className="rubicon-purchase rubicon-hover-surface dashboard-theme" aria-label={side === "sell" ? "Review your sale" : "Review your purchase"} aria-modal="true" onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab') return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, textarea:not(:disabled)') ?? []).filter(node => node.getClientRects().length > 0);
      const first = focusable[0], last = focusable.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }} onPointerDown={e => e.stopPropagation()} onCancel={e => { e.preventDefault(); close(); }}>
    <header className="purchase-heading"><div><span className="purchase-seal"/> RUBICON</div><button autoFocus onClick={close} aria-label="Close purchase"><X size={18}/></button></header>
    <div className="purchase-tabs" role="group" aria-label="Buy or sell"><button type="button" aria-pressed={side === "buy"} onClick={() => setSide("buy")}>Buy</button><button type="button" aria-pressed={side === "sell"} onClick={() => setSide("sell")}>Sell</button></div>
    {/* Only while the named stock is still what the panel is about. Once a
      * different asset is chosen this sentence would describe the wrong thing,
      * and the panel labels a tokenized stock itself. */}
    {side === "buy" && request?.asset?.kind === "stock" && !chosen && <p className="purchase-requirements">You’re exploring {request.asset.name}. Available purchases are tokenized exposures, not brokerage shares. Choose and verify the exact instrument below.</p>}
    {request && side === "sell" && <SellPanel key={`sell-${session}`} initialSymbol={request.asset?.symbol} initialHolding={request.holding} onDone={close} />}
    {request && side === "buy" && <BuyPanel key={session} onChoose={setChosen} preselected={request.asset?.contracts && Object.keys(request.asset.contracts).length ? { ...request.asset, contracts: request.asset.contracts } : undefined} initialQuery={request.query ?? request.asset?.symbol} initialAmount={request.amount} title={request.asset ? `Buy ${request.asset.symbol}` : 'Buy an asset'} onDone={close}/>}
  </dialog></div>;
}
