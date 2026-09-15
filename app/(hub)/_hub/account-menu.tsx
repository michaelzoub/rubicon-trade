"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { ChevronDown, LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CHAINS, formatUnits, shortAddress, type ChainId } from "@/lib/crypto/chains";
import { formatCredits, type AccountSummary } from "@/lib/socialtrading/plans";
import type { ThemeId } from "@/lib/socialtrading/themes";
import { usePrivyConfigured } from "../../providers";
import { ProfileAvatar } from "../profile-avatar";
import { useLinkedWallets } from "./wallets";

type Props = {
  userId: string; name?: string; planName: string; account: AccountSummary | null;
  themes: ThemeId[]; learned: ThemeId[];
  profileHref: string;
  /** Preview seam: no Privy, so balances and sign-out are unavailable. */
  preview: boolean;
};

/** One profile card in the header. Hover, tap, or focus opens the account:
 * credits, then wallets, then sign out. */
export function AccountMenu(props: Props) {
  const configured = usePrivyConfigured();
  if (props.preview || !configured) return <Menu {...props} wallets={<WalletLines lines={["Preview wallet · balances unavailable"]} />} signOut={null} />;
  return <LiveMenu {...props} />;
}

function LiveMenu(props: Props) {
  const { logout } = usePrivy();
  const linked = useLinkedWallets();
  const { wallets } = useWallets();
  const [open, setOpen] = useState(false);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const connectionKey = wallets.map(w => `${w.address}:${w.chainId}`).join(",");
  useEffect(() => {
    if (!open) return;
    let live = true;
    setBalances({});
    for (const wallet of wallets) {
      void (async () => {
        let label = "Balance unavailable";
        try {
          const provider = await wallet.getEthereumProvider();
          const network = CHAINS[Number(await provider.request({ method: "eth_chainId" })) as ChainId];
          if (!network) label = "Unsupported network";
          else {
            const [usdc, native] = await Promise.all([
              provider.request({ method: "eth_call", params: [{ to: network.usdc, data: `0x70a08231${wallet.address.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"] }),
              provider.request({ method: "eth_getBalance", params: [wallet.address, "latest"] }),
            ]);
            if (typeof usdc === "string" && typeof native === "string") label = `${formatUnits(BigInt(usdc).toString(), 6, 2)} USDC · ${formatUnits(BigInt(native).toString(), 18, 6)} ${network.nativeSymbol}\n${network.name} · current network`;
          }
        } catch { /* Keep unavailable distinct from a zero balance. */ }
        if (live) setBalances(b => ({ ...b, [wallet.address.toLowerCase()]: label }));
      })();
    }
    return () => { live = false; };
    // Privy can return fresh wallet objects each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionKey]);
  const lines = linked.length
    ? linked.map(w => `${shortAddress(w.address)}\n${balances[w.address] ?? (wallets.some(c => c.address.toLowerCase() === w.address) ? "Checking balance…" : "Connect to see balance")}`)
    : ["No wallet linked yet."];
  return <Menu {...props} onOpen={setOpen} wallets={<WalletLines lines={lines} />}
    signOut={<button type="button" className="hub-account-signout" onClick={() => void logout()}><LogOut size={14} aria-hidden="true" /><span>Sign out</span></button>} />;
}

function WalletLines({ lines }: { lines: string[] }) {
  return <>{lines.map((line, i) => <p key={i} className="hub-account-wallet">{line}</p>)}</>;
}

function Menu({ userId, name, planName, account, themes, learned, profileHref, wallets, signOut, onOpen }: Omit<Props, "preview"> & { wallets: ReactNode; signOut: ReactNode; onOpen?: (open: boolean) => void }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState(false);
  const change = (value: boolean) => {
    if (closing.current) { clearTimeout(closing.current); closing.current = null; }
    setOpen(value); onOpen?.(value);
  };
  // A short grace on leave so the cursor can cross from the card to the menu without it snapping shut.
  const leave = () => { closing.current = setTimeout(() => change(false), 140); };
  useEffect(() => () => { if (closing.current) clearTimeout(closing.current); }, []);

  const credits = account ? (() => {
    const { balanceMicros, holdMicros } = account.credits;
    const empty = balanceMicros < holdMicros, low = !empty && balanceMicros < 500_000;
    return { value: formatCredits(balanceMicros), state: empty ? "empty" : low ? "low" : "ok", note: empty ? "Out of credits" : low ? "Running low" : null };
  })() : null;
  const label = name ?? "Your account";

  return <div ref={root} className={`hub-account${open ? " is-open" : ""}`}
    onMouseEnter={() => change(true)} onMouseLeave={leave}
    onFocus={() => change(true)}
    onBlur={event => { if (!root.current?.contains(event.relatedTarget as Node | null)) change(false); }}
    // Focus returns to the card before closing, so the focus event cannot reopen the menu.
    onKeyDown={event => { if (event.key === "Escape") { trigger.current?.focus(); change(false); } }}>
    <button ref={trigger} type="button" className="hub-account-trigger" aria-haspopup="true" aria-expanded={open} aria-controls={id} onClick={() => change(!open)}>
      <ProfileAvatar seed={userId} themes={themes} inferred={learned} className="hub-account-avatar" />
      <span className="hub-account-name">{label}</span>
      <ChevronDown size={14} aria-hidden="true" className="hub-account-caret" />
    </button>
    <div id={id} className="rubicon-hover-surface hub-account-menu" hidden={!open} aria-label="Account">
      <Link href={profileHref} className="hub-account-head" onClick={() => change(false)}>
        <ProfileAvatar seed={userId} themes={themes} inferred={learned} className="hub-account-avatar" />
        <span className="hub-account-who"><strong>{label}</strong><small>{planName} plan · View profile</small></span>
      </Link>
      <section className="hub-account-section" aria-label="AI credits">
        <div className="hub-account-row">
          <span className="hub-account-label">AI credits</span>
          <span className={`hub-account-credits is-${credits?.state ?? "unknown"}`}>{credits?.value ?? "—"}</span>
        </div>
        <small>{credits?.note ?? "Pays for your agent’s model usage at the provider’s actual cost."}</small>
      </section>
      <section className="hub-account-section" aria-label="Wallet">
        <div className="hub-account-row">
          <span className="hub-account-label">Wallet</span>
          <Link href={profileHref} className="hub-account-manage" onClick={() => change(false)}>Manage</Link>
        </div>
        {wallets}
        <small>USDC and native token on each connected network.</small>
      </section>
      {signOut && <div className="hub-account-foot">{signOut}</div>}
    </div>
  </div>;
}
