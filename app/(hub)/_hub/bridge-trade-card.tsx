'use client';
import { useEffect, useRef, useState } from 'react';
import { useSign7702Authorization, useWallets } from '@privy-io/react-auth';
import type { TradeIntent } from '@/lib/socialtrading/types';
import { chain, explorerTx, formatUnits, shortAddress } from '@/lib/crypto/chains';
import { sendSwapBatch, type SignAuthorization } from '@/lib/crypto/gasless';
import { signStepTypedData } from '@/lib/crypto/purchase-client';
import { purchaseError } from '@/lib/crypto/readiness';
import { useHub } from './hub-provider';

export function BridgeTradeCard({ trade }: { trade: TradeIntent }) {
  const { crypto, state } = useHub(), { wallets } = useWallets();
  const { signAuthorization } = useSign7702Authorization();
  const c = trade.crypto!, b = c.bridge!, r = b.request;
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [hash, setHash] = useState(''), [stage, setStage] = useState('');
  const lock = useRef(false);
  const step = b.plan.steps[b.plan.currentStepIndex];
  const wallet = wallets.find(w => w.address.toLowerCase() === r.wallet);
  const key = `rubicon:bridge:${state.profile.userId}:${trade.id}:${b.issued?.stepIndex ?? b.plan.currentStepIndex}`;
  useEffect(() => { try { setHash(localStorage.getItem(key) || ''); } catch { setHash(''); } }, [key]);
  async function act(action: 'sign' | 'status' | 'recover') {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (action === 'sign') {
        if (!wallet) throw new Error(`Connect ${shortAddress(r.wallet)} to continue.`);
        const result = await crypto({ action: b.issued ? 'bridge_resume' : 'bridge_prepare', tradeId: trade.id });
        if (!result.expiresAt) throw new Error('No wallet action was returned.');

        // A route is a state machine, and a step is one of three shapes. Handling
        // only transactions is what used to strand a route at its Permit2 step.
        if (result.typedData) {
          const chainId = result.chainId ?? Number(result.typedData.domain.chainId);
          setStage('Approve this step · no network fee…');
          await wallet.switchChain(chainId);
          const provider = await wallet.getEthereumProvider();
          const signature = await signStepTypedData(provider, r.wallet, chainId, result.typedData, result.expiresAt);
          await crypto({ action: 'bridge_signed', tradeId: trade.id, signature });
        } else if (result.batch) {
          // The network fee comes out of USDC, so no step ever needs native gas.
          setStage('Sign this step · network fee paid in USDC…');
          await wallet.switchChain(result.batch.chainId);
          const provider = await wallet.getEthereumProvider();
          const sent = await sendSwapBatch({
            batch: result.batch, provider, signAuthorization: signAuthorization as SignAuthorization, expiresAt: result.expiresAt,
            onSubmitted: () => setStage('Submitted · awaiting confirmation…'),
          });
          setHash(sent.hash); try { localStorage.setItem(key, sent.hash); } catch { /* hash remains visible */ }
          await crypto({ action: 'bridge_submitted', tradeId: trade.id, hash: sent.hash, userOpHash: sent.userOpHash });
        } else {
          const tx = result.transaction;
          if (!tx) throw new Error('No wallet action was returned.');
          setStage('Sign this step in your wallet…');
          await wallet.switchChain(tx.chainId);
          const provider = await wallet.getEthereumProvider();
          const accounts = await provider.request({ method: 'eth_accounts' });
          if (!Array.isArray(accounts) || !accounts.some(a => String(a).toLowerCase() === r.wallet) || Number(await provider.request({ method: 'eth_chainId' })) !== tx.chainId) throw new Error('Wallet or network changed.');
          if (Date.now() >= result.expiresAt) throw new Error('The step expired. Check the purchase status.');
          // Preserve the exact server-issued calldata and nonce, including on retries.
          const sent = await provider.request({ method: 'eth_sendTransaction', params: [{ from: tx.from, to: tx.to, data: tx.data, value: `0x${BigInt(tx.value).toString(16)}`, nonce: tx.nonce }] });
          if (typeof sent !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(sent)) throw new Error('Recover the transaction hash from your wallet.');
          setHash(sent); try { localStorage.setItem(key, sent); } catch { /* hash remains visible */ }
          await crypto({ action: 'bridge_submitted', tradeId: trade.id, hash: sent });
        }
      } else if (action === 'recover') {
        await crypto({ action: 'bridge_submitted', tradeId: trade.id, hash: hash.trim() });
      }
      await crypto({ action: 'bridge_status', tradeId: trade.id });
    } catch (e) { setError(purchaseError(e)); }
    finally { lock.current = false; setBusy(false); setStage(''); }
  }
  useEffect(() => {
    // A broadcast step waits on its hash; a signed step waits on its proof. Only
    // a step still awaiting the wallet has nothing for polling to advance.
    if (['confirmed', 'failed', 'rejected', 'blocked'].includes(trade.status) || (b.issued && !b.issued.hash && !b.issued.signature)) return;
    const timer = setInterval(() => void act('status'), 8000);
    return () => clearInterval(timer);
    // Polling advances confirmed steps only; signing remains a user action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.status, b.issued?.hash, b.issued?.signature, b.plan.currentStepIndex]);
  const complete = trade.status === 'confirmed';
  return <div className="hub-trade hub-trade--crypto" aria-label="Cross-network purchase">
    <div className="hub-trade-head"><p className="hub-part-title">{complete ? 'Purchase complete' : 'Your purchase route'}</p></div>
    <p>{chain(r.chainId).name} → {chain(r.destinationChainId).name}</p>
    <p className="hub-trade-line">{formatUnits(r.amount, 6)} USDC → {formatUnits(b.plan.expectedOutput, c.display?.tokenOut.decimals ?? null)} {trade.asset.symbol.toUpperCase()}</p>
    <p className="purchase-requirements">{b.plan.gasFeeUSD ? `Estimated network fees: $${b.plan.gasFeeUSD}. ` : ''}{b.plan.timeEstimateMs ? `About ${Math.max(1, Math.ceil(b.plan.timeEstimateMs / 60000))} min. ` : ''}Network fees come out of your USDC — no {chain(r.chainId).nativeSymbol} needed. Swap slippage: 0.5% per swap, not an end-to-end guarantee.</p>
    <ol className="purchase-route-steps">{b.plan.steps.map(s => <li key={s.stepIndex} aria-current={s.stepIndex === b.plan.currentStepIndex ? 'step' : undefined}><span>{s.stepType.includes('APPROVAL') ? 'Approve token' : s.stepType.includes('BRIDGE') ? 'Bridge' : 'Swap'}{s.tokenInChainId ? ` · ${chain(s.tokenInChainId).name}` : ''}</span><small>{s.status === 'COMPLETE' ? 'Complete' : s.status === 'AWAITING_ACTION' ? 'Ready to sign' : s.status === 'IN_PROGRESS' ? 'Confirming…' : s.status === 'STEP_ERROR' ? 'Stopped' : 'Waiting'}</small>{s.proof?.txHash && s.tokenInChainId && <a href={explorerTx(s.tokenInChainId, s.proof.txHash)} target="_blank" rel="noreferrer">View transaction</a>}</li>)}</ol>
    {c.detail && <p className="hub-notice">{c.detail}</p>}
    {trade.status === 'failed' && b.plan.steps.filter(s => s.status === 'COMPLETE').slice(-1).map(s => <p key={s.stepIndex} className="purchase-requirements">Last completed step delivered {s.tokenOutAmount} base units of {s.tokenOut} on {s.tokenOutChainId ? chain(s.tokenOutChainId).name : 'the destination network'}.</p>)}
    {error && <p className="hub-error" role="alert">{error}</p>}
    {!b.issued && step?.status === 'AWAITING_ACTION' && ['reserved', 'approval_required'].includes(trade.status) && <button className="button button-primary" disabled={busy || !wallet} onClick={() => void act('sign')}>{busy ? stage || 'Check your wallet…' : 'Review next step in wallet'}</button>}
    {b.issued?.typedData && !b.issued.signature && <button className="button button-primary" disabled={busy || !wallet} onClick={() => void act('sign')}>{busy ? stage || 'Check your wallet…' : 'Approve this step in your wallet'}</button>}
    {b.issued && !b.issued.hash && !b.issued.typedData && <div className="hub-trade-recover"><p className="hub-notice">A wallet request was issued. Check your wallet before continuing. If sent, paste its transaction hash.</p><button className="hub-chip-button" disabled={busy || !wallet || b.issued.expiresAt <= Date.now()} onClick={() => void act('sign')}>Retry same wallet request</button><input className="socialtrading-input" aria-label="Route transaction hash" value={hash} onChange={e => setHash(e.target.value)} placeholder="0x…"/><button className="hub-chip-button" disabled={busy || !hash} onClick={() => void act('recover')}>Recover transaction</button></div>}
    {!complete && <button className="hub-chip-button" disabled={busy} onClick={() => void act('status')}>{busy ? 'Checking…' : 'Refresh purchase status'}</button>}
    <p className="purchase-requirements">You can close this dialog and resume from your trade history.</p>
  </div>;
}
