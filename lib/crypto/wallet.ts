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
