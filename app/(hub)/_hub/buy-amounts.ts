/** Amounts people think in, not amounts a machine would pick. */
const LADDER = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000];
/** What to offer before we know what anyone holds. */
export const DEFAULT_AMOUNTS = ["25", "50", "100", "250"];

const floor2 = (value: number) => Math.floor(value * 100) / 100;
const text = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(2);

/**
 * The amounts offered under the field, from what the buyer can actually spend.
 *
 * A fixed row of $25 · $50 · $100 · $250 is a menu written for someone else's
 * balance: hold forty dollars and three of the four are refusals, the fourth is
 * the smallest thing on offer, and the panel says "can't buy this yet" to a
 * purchase it could have made. So the row is built from the balance instead —
 * the round numbers that fit inside it, and last, all of it.
 *
 * `spendable` is the balance minus the fee the network takes out of the same
 * USDC, so the largest chip is an amount that actually clears. Below a dollar
 * nothing is offered: there is no amount to suggest, and the panel says why.
 */
export function buyAmounts(spendable: number | null): string[] {
  if (spendable === null || !Number.isFinite(spendable)) return DEFAULT_AMOUNTS;
  const all = floor2(spendable);
  if (all < 1) return [];
  const fits = LADDER.filter(value => value <= all);
  // Nothing round fits, so offer the balance in parts instead of a single
  // all-or-nothing chip.
  const steps = fits.length ? fits.slice(-3) : [all / 4, all / 2].map(floor2).filter(value => value >= 1);
  return [...new Set([...steps, all])].map(text);
}
