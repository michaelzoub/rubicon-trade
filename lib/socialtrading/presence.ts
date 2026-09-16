import type { Asset, HubState } from './types';
import { themeName } from './personalization';

export type PresenceContext = { kind: 'revisit' | 'buy'; asset: Pick<Asset, 'id' | 'symbol' | 'name'> & { themes?: string[] } };
/** Deliberately factual: browsing is interest, never evidence of investment fit. */
export function presenceNote(state: HubState, context: PresenceContext): string {
  const { asset, kind } = context;
  const theme = asset.themes?.find(t => state.profile.themes.some(p => p === t));
  const lens = theme ? `your ${themeName(theme)} thesis` : state.profile.thesis.trim() ? 'your thesis' : 'your investment goals';
  return kind === 'buy'
    ? `Before buying ${asset.symbol}, want to check the fit with ${lens} and what could go wrong?`
    : `You keep coming back to ${asset.symbol}. Shall we test it against ${lens}?`;
}
export function announcePresence(context: PresenceContext) {
  window.dispatchEvent(new CustomEvent('rubicon:presence', { detail: context }));
}
