"use client";

import { useFlow } from "@/lib/flow";
import { AuthStep } from "@/components/flow/AuthStep";
import { WalletStep } from "@/components/flow/WalletStep";
import { TradingExperience } from "@/components/trading/TradingExperience";

function FlowContent() {
  const { stage } = useFlow();

  if (stage === "auth") {
    return <AuthStep />;
  }

  if (stage === "wallet") {
    return <WalletStep />;
  }

  return <TradingExperience />;
}

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col">
      <div className="flex flex-1 flex-col">
        <FlowContent />
      </div>
    </main>
  );
}
