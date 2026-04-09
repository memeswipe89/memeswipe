import dynamic from "next/dynamic";

const StockChart = dynamic(() => import("@/components/StockChart"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full min-h-[600px] bg-[#13131f] text-white/40 text-sm rounded-xl">
      Initialising chart…
    </div>
  ),
});

// Default: Wrapped SOL — swap for any Solana token mint address
const DEFAULT_ADDRESS = "So11111111111111111111111111111111111111112";

export default function ChartPage() {
  return (
    <main className="w-full min-h-screen bg-[#0d0d18] p-4 md:p-6">
      <div className="w-full" style={{ height: "calc(100vh - 48px)" }}>
        <StockChart
          address={DEFAULT_ADDRESS}
          defaultInterval="15m"
        />
      </div>
    </main>
  );
}
