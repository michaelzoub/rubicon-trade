"use client";

import { useWallets } from "@privy-io/react-auth";
import { useState } from "react";
import { CHAINS, CHAIN_IDS, DEFAULT_CHAIN, type ChainId } from "@/lib/crypto/chains";

export function DepositFunds() {
  const { wallets } = useWallets();
  const [chainId, setChainId] = useState<ChainId>(DEFAULT_CHAIN);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const wallet = wallets.find(w => w.address === selected) ?? wallets[0];
  const network = CHAINS[chainId];
  if (!wallet) return <p className="socialtrading-caption">Connect a wallet to deposit USDC.</p>;
  return <div className="hub-deposit">
    <label className="hub-recover-field"><span>Deposit network</span>
      <select className="socialtrading-input" value={chainId} onChange={e => { setChainId(Number(e.target.value) as ChainId); setMessage(""); }}>
        {CHAIN_IDS.map(id => <option key={id} value={id}>{CHAINS[id].name}</option>)}
      </select>
    </label>
    {wallets.length > 1 && <label className="hub-recover-field"><span>Deposit wallet</span><select className="socialtrading-input" value={wallet.address} onChange={e => { setSelected(e.target.value); setMessage(""); }}>{wallets.map(w => <option key={w.address} value={w.address}>{w.address}</option>)}</select></label>}
    <p className="socialtrading-caption">Send native USDC on {network.name} to this address. Choose {network.name} in the sending wallet or exchange; switching here does not bridge funds. Purchases use USDC on Base.</p>
    <p className="mono" style={{ overflowWrap: "anywhere" }}>{wallet.address}</p>
    <div className="hub-asset-actions">
      <button type="button" className="hub-chip-button" onClick={() => void navigator.clipboard.writeText(wallet.address).then(() => setMessage("Address copied."), () => setMessage("Could not copy. Select the address above."))}>Copy deposit address</button>
      <button type="button" className="hub-chip-button" onClick={() => void wallet.switchChain(chainId).then(() => setMessage(`Wallet switched to ${network.name}.`), () => setMessage(`Could not switch. Select ${network.name} in your wallet.`))}>Switch wallet to {network.name}</button>
    </div>
    {message && <p className="socialtrading-caption" role="status">{message}</p>}
  </div>;
}
