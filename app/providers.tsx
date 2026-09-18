"use client";

import { base } from "viem/chains";
import { PrivyProvider } from "@privy-io/react-auth";
import { Provider as JotaiProvider } from "jotai";
import { createContext, useContext, type ReactNode } from "react";

const PrivyConfiguredContext = createContext(false);

export function AppProviders({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

  if (!appId) return <JotaiProvider><PrivyConfiguredContext.Provider value={false}>{children}</PrivyConfiguredContext.Provider></JotaiProvider>;

  return (
    <JotaiProvider>
      <PrivyConfiguredContext.Provider value>
        <PrivyProvider
          appId={appId}
          clientId={clientId}
          config={{
            defaultChain: base,
            supportedChains: [base],
            // Other networks are disabled: [mainnet, arbitrum, optimism, polygon].
            loginMethods: ["twitter", "email", "wallet"],
            appearance: { theme: "light", accentColor: "#18181b" },
            // A Rubicon wallet is ours to operate on the person's behalf, so it
            // signs without a second modal asking them to confirm what they
            // just pressed Buy for. The purchase itself is the consent, and the
            // server has already held it to the quote, the limits and the
            // wallet before anything is signed. An outside wallet still shows
            // its own prompt — that one is not ours to remove.
            embeddedWallets: { showWalletUIs: false },
          }}
        >
          {children}
        </PrivyProvider>
      </PrivyConfiguredContext.Provider>
    </JotaiProvider>
  );
}

/** True when Privy has an app id; sign-in hooks may only run inside a configured provider. */
export function usePrivyConfigured() {
  return useContext(PrivyConfiguredContext);
}
