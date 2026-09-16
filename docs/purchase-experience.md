# Consumer purchase flow

## Root cause and flow audit

The selected asset determines the transaction network (Base by default); USDC on Ethereum cannot fund a Base purchase. Previously BuyPanel switched networks during balance reads, allowed an unknown balance to pass validation, and displayed a USDC fee reserve half the size of the signed paymaster allowance.

Discovery: Privy `useWallets` supplies connected wallets; the selected address is passed through proposal, ownership verification, quote recipient/swapper, prepared batch sender, and signing. Missing/disconnected addresses are not replaced when signing. Reads now check both `eth_accounts` and `eth_chainId`, before and after balances. Reads never switch networks. A labeled user action requests switching; the review action also clearly names the target network and wallet.

Amounts: exact decimal conversion on the server; chain-specific Circle USDC addresses. The client fails closed on unknown funds, checks spend plus the complete USDC fee cap, shows native balance, and refreshes before quoting. The server rechecks chain and USDC funds before issuing calldata. Each signature checks wallet/network and quote expiry again.

Quotes: Uniswap EXACT_INPUT, validated chain, sender, recipient, input/output contracts, amount and slippage. Prepare requotes and refuses worse minimum output. Approvals: exact-size ERC20/Permit2 allowances, clearing nonzero allowance where required, then swap, in a single atomic operation. Permit2 expires after 30 minutes. Existing ERC20 allowances can outlive the transaction; do not promise every allowance disappears after a trade.

Execution: existing EIP-7702 Simple7702Account + EntryPoint v0.8 + Circle USDC paymaster. This is **user-paid USDC gas**, not Privy sponsorship. Multiple wallet requests can occur (network change, delegation authorization, fee permit, operation signature). UI no longer promises one signature. The fee cap displayed and the fee permit now agree.

Submission: synchronous client lock plus server optimistic revision claim. Persist the user-operation hash as soon as the bundler accepts it, before waiting for a receipt. Recovery reads the operation receipt without resubmitting and then sends the resulting transaction hash through server verification. Transaction hash recovery remains available. Pending transactions poll server verification; success requires matching calldata/sender and the operation's success event, a canonical block hash, and two subsequent blocks.

Unknown submission outcomes remain reserved. A disconnected wallet, rejected signature after preparation, or missing local recovery storage must not silently unlock a potentially signed operation. Check the wallet/bundler and recover its hash. No automatic retry sends another operation. A future server-side operation journal would improve recovery across devices; local storage alone is not durable cross-device recovery.

## Product decision

Keep acquisition contextual in Explore and asset details. Existing `openPurchase`/PurchaseDialog provides one shared flow; Home, Explore and Memory remain primary navigation. `/trade` already redirects to `/explore`; retain it. No additional top-level Buy destination is needed. Asset selection, amount and review progression now sits above a light-blue acquisition surface, with tactile presets and visible network/wallet readiness. Routing/contracts and approval explanations remain under disclosure. Keyboard buttons replace incorrect listbox semantics; reduced-motion behavior is retained.

## Sponsorship and deployment

Installed `@privy-io/react-auth` exposes `sponsor?: boolean` on `useSendTransaction`. This app does not use that transaction path, and dashboard state/TEE execution cannot be established from repository configuration. Do not add `sponsor: true` to the custom bundler path: it has no effect there.

To adopt Privy native sponsorship, enable sponsorship in the Privy dashboard, configure supported chains and spending controls, enable client-originated transactions, confirm TEE execution/migration, and implement and test the Privy sendTransaction path with explicit selected address. Sequential approvals would need individual lifecycle and receipt verification, or a supported atomic batch path. No sponsorship was enabled by this change.

Current deployment still requires `CRYPTO_RPC_URL_<chainId>` for server verification, `UNISWAP_API_KEY`, valid Privy credentials, and a reliable EIP-7702/EntryPoint v0.8 bundler (`NEXT_PUBLIC_BUNDLER_URL`, optionally containing `{chainId}`). The public fallback is rate-limited. External wallet compatibility and live paymaster simulation must be tested before release; automated fixtures do not establish funded mainnet execution.

Sources checked:
- https://docs.privy.io/wallets/gas-and-asset-management/gas/setup
- https://developers.circle.com/paymaster/addresses-and-events
- https://developers.circle.com/paymaster
