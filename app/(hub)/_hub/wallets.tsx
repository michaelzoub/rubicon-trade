"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { Link2, Plus, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { CHAINS, DEFAULT_CHAIN, type ChainId, shortAddress } from "@/lib/crypto/chains";
import { useHub } from "./hub-provider";

type Linked = { address: string; embedded: boolean; client: string };

/** EVM wallets on the signed-in Privy account. Linking and creation run through
 * Privy's own modal, so keys never touch this app. */
export function useLinkedWallets(): Linked[] {
  const { user } = usePrivy();
  return (user?.linkedAccounts ?? []).flatMap(a => a.type === "wallet" && a.chainType === "ethereum" ? [{ address: a.address.toLowerCase(), embedded: a.walletClientType === "privy", client: a.walletClientType === "privy" ? "Embedded wallet" : a.walletClientType ?? "External wallet" }] : []);
}

export function WalletsSection({ compact = false }: { compact?: boolean }) {
  const { linkWallet, createWallet, connectWallet } = usePrivy();
  const { wallets: connected } = useWallets();
  const { wallets: verified } = useHub();
  const linked = useLinkedWallets();
  const [server, setServer] = useState<string[] | null>(null);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const connectionKey = connected.map(w => `${w.address}:${w.chainId}`).join(",");
  useEffect(() => {
    let live = true;
    setBalances({});
    void Promise.all(connected.map(async w => {
      let label = "Balance unavailable";
      try {
        const provider = await w.getEthereumProvider();
        const id = Number(await provider.request({ method: "eth_chainId" })) as ChainId;
        const network = CHAINS[id];
        if (network && id === DEFAULT_CHAIN) {
          const value = await provider.request({ method: "eth_call", params: [{ to: network.usdc, data: `0x70a08231${w.address.slice(2).toLowerCase().padStart(64, "0")}` }, "latest"] });
          if (typeof value === "string" && /^0x[0-9a-f]+$/i.test(value)) label = `${(Number(BigInt(value)) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC · ${network.name}`;
        }
      } catch { /* A disconnected wallet can still be linked and managed. */ }
      return [w.address.toLowerCase(), label] as const;
    })).then(entries => { if (live) setBalances(Object.fromEntries(entries)); });
    return () => { live = false; };
    // Wallet hooks can return a fresh array each render; refresh when connection or network changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionKey]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { let live = true; verified().then(w => { if (live) setServer(w); }).catch(() => { if (live) setServer([]); }); return () => { live = false; }; }, [verified, linked.length]);
  const isConnected = (address: string) => connected.some(w => w.address.toLowerCase() === address);
  const hasEmbedded = linked.some(w => w.embedded);
  async function create() {
    setCreating(true); setError("");
    try { await createWallet(); } catch (e) { setError(e instanceof Error ? e.message : "The wallet could not be created."); }
    finally { setCreating(false); }
  }
  return <div className={`hub-wallets${compact ? " is-compact" : ""}`}>
    {linked.length === 0 && <p className="hub-empty">No wallet yet. Create an embedded wallet in seconds, or link one you already use. Swaps settle from a wallet you control; your agent never holds keys.</p>}
    {linked.length > 0 && <ul className="hub-wallet-list">
      {linked.map(w => <li key={w.address} className="hub-wallet">
        <Wallet size={14} aria-hidden="true" />
        <div className="hub-wallet-id"><strong className="mono">{shortAddress(w.address)}</strong><span>{balances[w.address] ?? (isConnected(w.address) ? "Checking balance…" : "Connect to see balance")}</span><span>{w.client}{server && !server.includes(w.address) ? " · not yet verified" : ""}</span></div>
        {isConnected(w.address) ? <span className="hub-label hub-label--related">Ready to sign</span> : <button type="button" className="hub-chip-button" onClick={() => connectWallet()}>Connect</button>}
      </li>)}
    </ul>}
    <div className="hub-asset-actions">
      {!hasEmbedded && <button type="button" className="hub-chip-button" disabled={creating} onClick={() => void create()}><Plus size={12} aria-hidden="true" />{creating ? "Creating…" : "Create embedded wallet"}</button>}
      <button type="button" className="hub-chip-button" onClick={() => linkWallet({ walletChainType: "ethereum-only" })}><Link2 size={12} aria-hidden="true" />Link a wallet</button>
    </div>
    {error && <p className="hub-error" role="alert">{error}</p>}
  </div>;
}
