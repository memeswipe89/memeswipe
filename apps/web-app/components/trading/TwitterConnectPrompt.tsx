"use client";

type TwitterConnectPromptProps = {
  visible: boolean;
  loading: boolean;
  onConnect: () => void;
  onDismiss: () => void;
  error?: string;
};

export function TwitterConnectPrompt({ visible, loading, onConnect, onDismiss, error }: TwitterConnectPromptProps) {
  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/80 p-6 text-center text-white">
        <p className="text-xs uppercase tracking-[0.4em] text-slate-400">Twitter connect</p>
        <h2 className="mt-2 text-2xl font-semibold">Link your Twitter</h2>
        <p className="mt-2 text-sm text-slate-300">
          Connect Twitter to power sentiment and trade automations just like the mobile experience.
        </p>
        {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
        <div className="mt-6 space-y-3">
          <button
            onClick={onConnect}
            disabled={loading}
            className="w-full rounded-2xl bg-gradient-to-r from-sky-500 to-indigo-500 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Connecting…" : "Connect Twitter"}
          </button>
          <button
            onClick={onDismiss}
            className="w-full rounded-2xl border border-white/30 px-4 py-3 text-xs font-semibold uppercase tracking-[0.3em] text-white transition hover:border-white"
          >
            Maybe later
          </button>
        </div>
        <p className="mt-4 text-[10px] uppercase tracking-[0.4em] text-slate-500">By connecting you agree to the Terms.</p>
      </div>
    </div>
  );
}
