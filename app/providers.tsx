"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { createContext, useContext, type ReactNode } from "react";

const PrivyConfiguredContext = createContext(false);

export function AppProviders({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

  if (!appId) return <PrivyConfiguredContext.Provider value={false}>{children}</PrivyConfiguredContext.Provider>;

  return (
    <PrivyConfiguredContext.Provider value>
      <PrivyProvider
        appId={appId}
        clientId={clientId}
        config={{
          loginMethods: ["twitter", "email", "wallet"],
          appearance: { theme: "light", accentColor: "#18181b" },
        }}
      >
        {children}
      </PrivyProvider>
    </PrivyConfiguredContext.Provider>
  );
}

/** True when Privy has an app id; sign-in hooks may only run inside a configured provider. */
export function usePrivyConfigured() {
  return useContext(PrivyConfiguredContext);
}
