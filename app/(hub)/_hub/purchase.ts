import type { Asset } from '@/lib/socialtrading/types';
export type PurchaseRequest = { asset?: Pick<Asset, 'symbol' | 'name' | 'contracts' | 'kind'>; query?: string; amount?: string };
export function openPurchase(request: PurchaseRequest = {}) {
  window.dispatchEvent(new CustomEvent<PurchaseRequest>('rubicon:purchase', { detail: request }));
}
export function purchaseIntent(text: string): PurchaseRequest | null {
  const match = text.trim().match(/^(?:please\s+)?buy\s+\$((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)\s+(?:of\s+)?([\w. -]+?)[.!]?$/i);
  if (!match || !Number.isFinite(Number(match[1].replaceAll(',', ''))) || Number(match[1].replaceAll(',', '')) <= 0) return null;
  return { amount: match[1].replaceAll(',', ''), query: match[2].trim() };
}
