"use client";

import { PrivyProvider } from "@privy-io/react-auth";

export default function WebPrivyProvider({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "twitter"],
      }}
    >
      {children}
    </PrivyProvider>
  );
}