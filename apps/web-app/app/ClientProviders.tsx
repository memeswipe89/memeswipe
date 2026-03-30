"use client";

import React from "react";
import WebPrivyProvider from "@/lib/PrivyProvider";
import { FlowProvider } from "@/lib/flow";
import { TradeSettingsProvider } from "@/lib/trade-settings-context";

type ClientProvidersProps = {
  children: React.ReactNode;
};

export default function ClientProviders({ children }: ClientProvidersProps) {
  return (
    <WebPrivyProvider>
      <TradeSettingsProvider>
        <FlowProvider>{children}</FlowProvider>
      </TradeSettingsProvider>
    </WebPrivyProvider>
  );
}
