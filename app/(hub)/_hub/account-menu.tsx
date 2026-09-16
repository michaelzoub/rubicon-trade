"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { ArrowUpRight, Check, ChevronDown, ChevronLeft, ChevronRight, Copy, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { CHAINS, formatUnits, type ChainId } from "@/lib/crypto/chains";
import { qrMatrix } from "@/lib/crypto/qr";
import { formatCredits, type AccountSummary } from "@/lib/socialtrading/plans";
import type { ThemeId } from "@/lib/socialtrading/themes";
import type { HubState } from "@/lib/socialtrading/types";
import { usePrivyConfigured } from "../../providers";
import { useWalletBalanceCache, type WalletBalance } from "./account-state";
import { IdentityAura } from "./identity-aura";
import { useLinkedWallets } from "./wallets";

type Props = {
  userId: string; name?: string; planName: string; account: AccountSummary | null;
  themes: ThemeId[]; inferred: HubState["inferred"];
  identity: { progress: number; depth: number; energy: number };
  profileHref: string;
  plansHref: string;
  /** Preview seam: no Privy, so balances and sign-out are unavailable. */
  preview: boolean;
};

/** One wallet as the card shows it. `balance` is undefined until the menu has asked the network. */
export type WalletEntry = { address: string; kind: string; connected: boolean; balance?: WalletBalance };

/** One profile card in the header. Hover, tap, or focus opens a small identity card:
 * who you are, your credits, your wallet, then sign out. */
export function AccountMenu(props: Props) {
  const configured = usePrivyConfigured();
  if (props.preview) return <Menu {...props} wallets={PREVIEW_WALLETS} signOut={null} />;
  if (!configured) return <Menu {...props} wallets={[]} signOut={null} />;
  return <LiveMenu {...props} />;
}

/** The preview fixture's wallet with a fixed balance, so the whole card can be seen without Privy. */
const PREVIEW_WALLETS: WalletEntry[] = [{ address: "0x1111111111111111111111111111111111111111", kind: "Embedded wallet", connected: true, balance: { state: "ok", network: "Base", usdc: "25", native: "1", symbol: "ETH" } }];

function LiveMenu(props: Props) {
  const { logout } = usePrivy();
  const linked = useLinkedWallets();
  const { wallets } = useWallets();
  const [open, setOpen] = useState(false);
  const { cache, start, finish } = useWalletBalanceCache(props.userId);
  const connectionKey = wallets.map(w => `${w.address.toLowerCase()}:${w.chainId}`).sort().join(",");
  useEffect(() => {
    if (!open || !start(connectionKey)) return;
    void Promise.all(wallets.map(async wallet => {
        let balance: WalletBalance = { state: "unavailable" };
        try {
          const provider = await wallet.getEthereumProvider();
          const network = CHAINS[Number(await provider.request({ method: "eth_chainId" })) as ChainId];
          if (network) {
            const [usdc, native] = await Promise.all([
              provider.request({ method: "eth_call", params: [{ to: network.usdc, data: `0x70a08231${wallet.address.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"] }),
              provider.request({ method: "eth_getBalance", params: [wallet.address, "latest"] }),
            ]);
            if (typeof usdc === "string" && typeof native === "string") balance = { state: "ok", network: network.name, usdc: formatUnits(BigInt(usdc).toString(), 6, 2), native: formatUnits(BigInt(native).toString(), 18, 6), symbol: network.nativeSymbol };
          }
        } catch { /* Keep unavailable distinct from a zero balance. */ }
        return [wallet.address.toLowerCase(), balance] as const;
      })).then(entries => finish(connectionKey, Object.fromEntries(entries)));
    // Privy can return fresh wallet objects each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionKey]);
  const balances = cache?.connectionKey === connectionKey ? cache.balances : {};
  const entries: WalletEntry[] = linked.map(w => ({ address: w.address, kind: w.client, connected: wallets.some(c => c.address.toLowerCase() === w.address), balance: balances[w.address] }));
  return <Menu {...props} onOpen={setOpen} wallets={entries}
    signOut={<button type="button" className="hub-account-signout" onClick={() => void logout()}><LogOut size={14} aria-hidden="true" /><span>Sign out</span></button>} />;
}

function Menu({ userId, name, planName, account, themes, inferred, identity, profileHref, plansHref, preview, wallets, signOut, onOpen }: Props & { wallets: WalletEntry[]; signOut: ReactNode; onOpen?: (open: boolean) => void }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerWasOpen = useRef<boolean | null>(null);
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const change = (value: boolean) => {
    if (closing.current) { clearTimeout(closing.current); closing.current = null; }
    setOpen(value); onOpen?.(value);
    if (!value) setDetail(null);
  };
  // A short grace on leave so the cursor can cross from the card to the menu without it snapping shut.
  const leave = () => { closing.current = setTimeout(() => change(false), 140); };
  useEffect(() => () => { if (closing.current) clearTimeout(closing.current); }, []);

  const credits = account ? (() => {
    const { balanceMicros, holdMicros } = account.credits;
    const empty = balanceMicros < holdMicros, low = !empty && balanceMicros < 500_000;
    return { value: formatCredits(balanceMicros), state: empty ? "empty" : low ? "low" : "ok" };
  })() : null;
  const label = name ?? "Your account";
  const shown = detail ? wallets.find(w => w.address === detail) : undefined;

  return <div ref={root} className={`hub-account${open ? " is-open" : ""}`}
    onMouseEnter={() => change(true)} onMouseLeave={leave}
    onFocus={() => change(true)}
    onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node | null)) change(false); }}
    // Focus returns to the card before closing, so the focus event cannot reopen the menu.
    onKeyDown={event => { if (event.key === "Escape") { trigger.current?.focus(); change(false); } }}>
    <button ref={trigger} type="button" className="hub-account-trigger" aria-haspopup="true" aria-expanded={open} aria-controls={id}
      onPointerDown={() => { pointerWasOpen.current = open; }}
      onClick={() => { const beforePointer = pointerWasOpen.current; pointerWasOpen.current = null; change(beforePointer === null ? !open : !beforePointer); }}>
      <AccountOrb seed={userId} themes={themes} inferred={inferred} identity={identity} compact />
      <span className="hub-account-name">{label}</span>
      <ChevronDown size={14} aria-hidden="true" className="hub-account-caret" />
    </button>
    <div id={id} className="rubicon-hover-surface hub-account-menu" hidden={!open} aria-label="Account">
      {shown
        ? <WalletDetail key={shown.address} wallet={shown} onBack={() => setDetail(null)} />
        : <div key="summary" className="hub-account-pane is-summary">
          <Link href={profileHref} className="hub-account-head" onClick={() => change(false)}>
            <AccountOrb seed={userId} themes={themes} inferred={inferred} identity={identity} />
            <span className="hub-account-who"><strong>{label}</strong><small>{planName} plan</small></span>
            <ArrowUpRight size={14} aria-hidden="true" className="hub-account-head-arrow" />
          </Link>
          <div className="hub-account-body">
            <Link href={plansHref} className="hub-account-row is-link" aria-label="AI credits" onClick={() => change(false)}>
              <span className="hub-account-label">AI credits</span>
              <span className={`hub-account-credits is-${credits?.state ?? "unknown"}`}>{credits?.value ?? "—"}</span>
              <ChevronRight size={14} aria-hidden="true" className="hub-account-chevron" />
            </Link>
            {!preview && wallets.length === 0 && <Link href={profileHref} className="hub-account-row is-link" onClick={() => change(false)}>
              <span className="hub-account-label">Wallet</span><span className="hub-account-value is-quiet">Add</span><ChevronRight size={14} aria-hidden="true" className="hub-account-chevron" />
            </Link>}
            {wallets.map(w => <button key={w.address} type="button" className="hub-account-row is-link hub-account-wallet" onClick={() => setDetail(w.address)}>
              <span className="hub-account-label">{wallets.length > 1 ? w.kind : "Wallet"}</span>
              <span className={`hub-account-value${w.balance?.state === "ok" ? "" : " is-quiet"}`}>{walletSummary(w)}</span>
              <ChevronRight size={14} aria-hidden="true" className="hub-account-chevron" />
            </button>)}
          </div>
        </div>}
      {signOut && <div className="hub-account-foot">{signOut}</div>}
    </div>
  </div>;
}

/** The account control uses the same evolving identity object as Profile—not an
 * agent portrait—so the person remains the center of the product everywhere. */
function AccountOrb({ seed, themes, inferred, identity, compact = false }: {
  seed: string; themes: ThemeId[]; inferred: HubState["inferred"];
  identity: Props["identity"]; compact?: boolean;
}) {
  return <span className={`hub-account-orb${compact ? " is-compact" : ""}`} aria-hidden="true">
    <IdentityAura seed={seed} themes={themes} inferred={inferred} progress={identity.progress}
      depth={identity.depth} energy={identity.energy} label="" className="hub-account-aura" />
  </span>;
}

function walletSummary(wallet: WalletEntry): string {
  if (wallet.balance?.state === "ok") return `${wallet.balance.usdc} USDC`;
  if (wallet.balance?.state === "unavailable") return "Unavailable";
  return wallet.connected ? "Checking…" : "Not connected";
}

function WalletDetail({ wallet, onBack }: { wallet: WalletEntry; onBack: () => void }) {
  const back = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => { back.current?.focus(); }, []);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(wallet.address); setCopied(true); } catch { /* Selecting the address by hand still works. */ }
  };
  const balance = wallet.balance;
  return <div className="hub-account-pane is-detail" aria-label="Wallet details">
    <button ref={back} type="button" className="hub-account-back" onClick={onBack}><ChevronLeft size={14} aria-hidden="true" /><span>Wallet</span></button>
    <div className="hub-account-qr"><QrCode value={wallet.address} /></div>
    <p className="hub-account-address">{wallet.address}</p>
    <button type="button" className={`hub-account-copy${copied ? " is-copied" : ""}`} onClick={() => void copy()} aria-live="polite">
      {copied ? <><Check size={13} aria-hidden="true" /><span>Copied</span></> : <><Copy size={13} aria-hidden="true" /><span>Copy address</span></>}
    </button>
    <dl className="hub-account-facts">
      <div><dt>Network</dt><dd>{balance?.state === "ok" ? balance.network : wallet.connected ? (balance ? "Unavailable" : "Checking…") : "Not connected"}</dd></div>
      {balance?.state === "ok" && <>
        <div><dt>USDC</dt><dd>{balance.usdc}</dd></div>
        <div><dt>{balance.symbol}</dt><dd>{balance.native}</dd></div>
      </>}
    </dl>
  </div>;
}

/** The address as a QR code: one path, sized by CSS. Light margin comes from the surrounding tile. */
function QrCode({ value }: { value: string }) {
  const { size, path } = useMemo(() => {
    const matrix = qrMatrix(value);
    let d = "";
    matrix.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c} ${r}h1v1h-1z`; }));
    return { size: matrix.length, path: d };
  }, [value]);
  return <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR code for ${value}`} shapeRendering="crispEdges"><path d={path} fill="currentColor" /></svg>;
}
