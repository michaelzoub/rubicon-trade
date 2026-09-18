import "server-only";
import { PrivyClient } from "@privy-io/node";
import { address } from "./chains";
export async function userWallets(userId: string): Promise<string[]> {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID, appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Privy is not configured.");
  const user = await new PrivyClient({ appId, appSecret }).users()._get(userId);
  return [...new Set(user.linked_accounts.flatMap(a => a.type === "wallet" && a.chain_type === "ethereum" ? [address(a.address)] : []))];
}
export async function ownedWallet(userId: string, wallet: string) {
  const normalized = address(wallet);
  if (!(await userWallets(userId)).includes(normalized)) throw new Error("This wallet is not linked to your Privy account.");
  return normalized;
}

/** The wallet a delegated signer may act for, or null.
 *
 * A wallet is only delegable when Privy reports it as an embedded wallet with a
 * signer attached — the grant the user made and can revoke. Returning null
 * rather than throwing lets callers treat "not delegated" as an ordinary state
 * and refuse politely, which is what the scheduled agent does. */
export async function delegatedWallet(userId: string, wallet: string): Promise<{ id: string; address: string } | null> {
  const normalized = address(wallet);
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID, appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) return null;
  const user = await new PrivyClient({ appId, appSecret }).users()._get(userId);
  for (const account of user.linked_accounts) {
    if (account.type !== "wallet" || account.chain_type !== "ethereum") continue;
    if (address(account.address) !== normalized) continue;
    const a = account as { id?: string; delegated?: boolean };
    // Privy's own test for a delegated wallet: it has a server wallet id and the
    // flag is set. Deliberately not also matching `wallet_client_type`, which
    // would reject a `privy-v2` wallet the grant UI happily delegates — the
    // person would grant a signer, see the toggle enable, and then watch every
    // scheduled purchase refuse for a reason nothing on screen explains.
    if (!a.id || a.delegated !== true) return null;
    return { id: a.id, address: normalized };
  }
  return null;
}

/** The first of this user's wallets that carries a delegated signer, or null.
 *
 * Used to answer "may the agent buy unattended?" before any trade exists, so it
 * asks about the account rather than about a particular proposal. */
export async function firstDelegatedWallet(userId: string): Promise<{ id: string; address: string } | null> {
  for (const wallet of await userWallets(userId)) {
    const delegated = await delegatedWallet(userId, wallet);
    if (delegated) return delegated;
  }
  return null;
}
