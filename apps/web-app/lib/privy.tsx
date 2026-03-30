import { PrivyProvider } from "@privy-io/react-auth";
import { ReactNode } from "react";
import { isPrivyConfigured, PRIVY_APP_ID, PRIVY_CLIENT_ID } from "@/lib/config";
"use client";

type WebPrivyProviderProps = {
  children: ReactNode;
};

export function WebPrivyProvider({ children }: WebPrivyProviderProps) {
  if (!isPrivyConfigured) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      clientId={PRIVY_CLIENT_ID}
      config={{
        appearance: {
          theme: "dark",
        },
        loginMethods: ["twitter", "email"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
