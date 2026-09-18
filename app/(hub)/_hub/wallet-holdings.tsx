"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Holding } from '@/lib/crypto/recovery';
import { BUY_CHAIN } from '@/lib/crypto/tradable';
import { catalogEntry } from '@/lib/crypto/catalog';
import { useHub } from './hub-provider';
import { AssetLogo } from './parts';
import { openPurchase } from './purchase';

export function WalletHoldings() {
  const { crypto, state } = useHub();
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [loading, setLoading] = useState(true);
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError('');
    try {
      const result = await crypto({ action: 'holdings' });
      if (request !== generation.current) return;
      setHoldings((result.holdings ?? []).filter(h => h.kind !== 'usdc' && h.chainId === BUY_CHAIN));
      setPartial(result.complete === false);
    } catch { if (request === generation.current) setError('Couldn’t check your holdings. Try refreshing.'); }
    finally { if (request === generation.current) setLoading(false); }
  }, [crypto]);
  const settled = state.trades.filter(t => t.status === 'confirmed').map(t => t.id).join(':');
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load, settled]);
  return <section className="belief-holdings" aria-labelledby="belief-holdings-title">
    <header><h2 id="belief-holdings-title">Your holdings</h2><button className="hub-inline-link" disabled={loading} onClick={() => void load()}>{loading ? 'Checking…' : 'Refresh'}</button></header>
    {error && <p className="hub-error" role="alert">{error}</p>}
    {partial && <p role="status" className="belief-footnote">Some balances couldn’t be checked. Refresh to try again.</p>}
    {!loading && !error && !holdings.length && <p className="hub-empty">No wallet holdings found yet.</p>}
    <ul>{holdings.map(h => <li key={`${h.chainId}:${h.wallet}:${h.token}`}><AssetLogo asset={{ symbol: h.symbol, logo: catalogEntry(h.chainId, h.token)?.icon }}/><div><strong>{h.symbol}</strong><small>{h.chainName}{holdings.filter(other => other.chainId === h.chainId && other.token === h.token).length > 1 ? ` · ${h.wallet.slice(0, 6)}…${h.wallet.slice(-4)}` : ''}</small></div><span>{h.display}</span><button className="hub-chip-button" aria-label={`Sell ${h.symbol} on ${h.chainName}`} disabled={loading || !!error} onClick={() => openPurchase({ side: 'sell', holding: { chainId: h.chainId, wallet: h.wallet, token: h.token } })}>Sell</button></li>)}</ul>
  </section>;
}
