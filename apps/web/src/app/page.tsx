export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#06070b] text-white relative overflow-hidden">
      <div className="absolute inset-0">
        <div className="absolute -top-40 right-0 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,_rgba(77,214,255,0.22),_transparent_60%)] blur-2xl"></div>
        <div className="absolute top-40 -left-32 h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,_rgba(183,244,107,0.18),_transparent_60%)] blur-2xl"></div>
        <div className="absolute bottom-[-220px] right-[10%] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,_rgba(255,180,84,0.2),_transparent_60%)] blur-2xl"></div>
        <div className="absolute inset-0 bg-[linear-gradient(120deg,_rgba(12,18,34,0.9)_0%,_rgba(6,7,11,0.6)_45%,_rgba(10,16,28,0.95)_100%)]"></div>
      </div>

      <header className="relative z-10 px-6 pt-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-5 py-3 backdrop-blur">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400 to-lime-300 text-black font-bold">
              MS
            </div>
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-cyan-200/70">Memeswipe</p>
              <p className="text-xs text-white/60">Swipe memecoins. Trade instantly.</p>
            </div>
          </div>
          <div className="hidden items-center gap-6 text-sm text-white/70 md:flex">
            <a className="hover:text-white transition-colors" href="#how">How it works</a>
            <a className="hover:text-white transition-colors" href="#safety">Safety</a>
            <a className="hover:text-white transition-colors" href="/waitlist">Waitlist</a>
          </div>
            <a
              href="/waitlist"
              className="rounded-xl border border-cyan-400/60 bg-cyan-500/20 px-4 py-2 text-sm font-semibold text-cyan-100 hover:border-cyan-300 hover:bg-cyan-400/30 transition"
            >
              Join waitlist
            </a>
        </div>
      </header>

      <main className="relative z-10">
        <section className="mx-auto grid max-w-6xl gap-10 px-6 pb-16 pt-16 md:grid-cols-[1.1fr_0.9fr] md:items-center">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs uppercase tracking-[0.25em] text-lime-200/80">
              Early access
              <span className="h-1.5 w-1.5 rounded-full bg-lime-300"></span>
            </div>
            <h1 className="text-balance text-4xl font-semibold leading-tight text-white md:text-5xl">
              MemeSwipe is the fastest way to discover, swipe, and trade fresh memecoins.
            </h1>
            <p className="text-balance text-lg text-white/70">
              Tinder-speed discovery plus one-tap swaps. Set TP/SL, track live PnL, and close in seconds. Built for Solana.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row">
              <a
                href="/waitlist"
                className="inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-lime-300 px-6 py-3 text-sm font-semibold text-black shadow-lg shadow-cyan-500/30 transition hover:translate-y-[-1px]"
              >
                Join waitlist
              </a>
              <div className="flex items-center gap-3 text-sm text-white/60">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 font-mono text-[10px] uppercase tracking-[0.2em]">
                  Fast
                </span>
                <span>Live swaps. No charts. Pure momentum.</span>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {[
                { label: 'Speed', value: '<2s quote' },
                { label: 'Guard', value: 'Liquidity filters' },
                { label: 'Control', value: 'TP/SL triggers' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                    {item.label}
                  </p>
                  <p className="mt-2 text-lg font-semibold text-white">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>
          </div>
          <div className="relative">
            <div className="rounded-[28px] border border-cyan-400/30 bg-gradient-to-br from-white/10 to-white/5 p-6 shadow-[0_0_40px_rgba(77,214,255,0.2)]">
              <div className="flex items-center justify-between text-xs text-white/60">
                <span className="uppercase tracking-[0.2em]">Live deck</span>
                <span className="rounded-full border border-white/10 bg-white/10 px-3 py-1">Solana</span>
              </div>
              <div className="mt-6 rounded-2xl border border-white/10 bg-[#0c1220] p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-lg font-semibold">NEON KITTY</p>
                    <p className="text-xs text-white/50">Liquidity: $510k</p>
                  </div>
                  <div className="rounded-full border border-lime-300/30 bg-lime-300/10 px-3 py-1 text-xs text-lime-200">
                    Trending
                  </div>
                </div>
                <div className="mt-5 grid gap-3 text-sm">
                  <div className="flex justify-between text-white/70">
                    <span>Entry</span>
                    <span className="font-mono">$0.00032</span>
                  </div>
                  <div className="flex justify-between text-white/70">
                    <span>TP / SL</span>
                    <span className="font-mono">+45% / -10%</span>
                  </div>
                  <div className="flex justify-between text-white/70">
                    <span>Quote</span>
                    <span className="font-mono text-cyan-300">0.005 SOL</span>
                  </div>
                </div>
                <div className="mt-5 flex gap-3">
                  <button className="flex-1 rounded-xl border border-white/10 bg-white/5 py-2 text-xs text-white/60">
                    Swipe left
                  </button>
                  <button className="flex-1 rounded-xl bg-lime-300/90 py-2 text-xs font-semibold text-black">
                    Swipe right
                  </button>
                </div>
              </div>
              <div className="mt-6 grid gap-3">
                {[
                  { title: 'Auto-close', text: 'TP/SL fires while you are away.' },
                  { title: 'Privy wallets', text: 'Your keys stay yours.' },
                ].map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-semibold">{item.title}</p>
                    <p className="text-xs text-white/60">{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className="pointer-events-none absolute -bottom-10 left-6 right-6 h-24 rounded-full bg-cyan-500/20 blur-2xl"></div>
          </div>
        </section>

        <section id="how" className="mx-auto max-w-6xl px-6 pb-20">
          <div className="flex flex-col gap-3">
            <p className="text-xs uppercase tracking-[0.35em] text-white/50">How it works</p>
            <h2 className="text-3xl font-semibold">Swipe. Route. Execute.</h2>
            <p className="text-white/60 text-balance max-w-2xl">
              MemeSwipe keeps the loop tight: curated feeds, fast quotes, and on-chain settlement with your wallet.
            </p>
          </div>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            {[
              {
                title: 'Curated feed',
                text: 'Only liquid tokens make the deck. Filters keep spam and dead pools out.',
              },
              {
                title: 'One-tap routes',
                text: 'Quotes come from Jupiter routes with liquidity checks and slippage guards.',
              },
              {
                title: 'Smart exits',
                text: 'TP/SL monitors keep exits consistent and fast.',
              },
            ].map((item) => (
              <div key={item.title} className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <p className="text-lg font-semibold">{item.title}</p>
                <p className="mt-2 text-sm text-white/60">{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="safety" className="mx-auto grid max-w-6xl gap-8 px-6 pb-20 md:grid-cols-[0.9fr_1.1fr] md:items-center">
          <div className="rounded-3xl border border-white/10 bg-gradient-to-br from-white/10 to-white/5 p-8">
            <p className="text-xs uppercase tracking-[0.35em] text-white/50">Safety & control</p>
            <h3 className="mt-3 text-2xl font-semibold">You stay in control of every trade.</h3>
            <p className="mt-3 text-sm text-white/60">
              MemeSwipe uses non-custodial wallets, clear routing, and fail-safe exit paths. If a close fails, you can mark it and move on.
            </p>
            <div className="mt-6 grid gap-4">
              {[
                'Non-custodial wallet via Privy',
                'Liquidity thresholds enforced',
                'Swap simulation before execution',
              ].map((item) => (
                <div key={item} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                  <span className="h-2 w-2 rounded-full bg-lime-300"></span>
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8">
            <p className="text-xs uppercase tracking-[0.35em] text-white/50">Built for speed</p>
            <h3 className="mt-3 text-2xl font-semibold">Trade tabs that feel like a game.</h3>
            <p className="mt-3 text-sm text-white/60">
              Live PnL, close buttons, and clean post-trade summaries. Trade faster with fewer screens.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              {[
                { label: 'Average swap', value: '~4s' },
                { label: 'Route sources', value: 'Jupiter' },
                { label: 'Monitoring', value: 'TP / SL watchers' },
                { label: 'Alerts', value: 'Push ready' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-[#0c1220] p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-white/50">{item.label}</p>
                  <p className="mt-2 text-lg font-semibold">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="rounded-[32px] border border-cyan-400/30 bg-gradient-to-br from-[#0b1422] to-[#0b0f16] p-10 text-center shadow-[0_0_50px_rgba(77,214,255,0.15)]">
            <p className="text-xs uppercase tracking-[0.35em] text-cyan-200/70">Waitlist</p>
            <h2 className="mt-3 text-3xl font-semibold text-balance">Ready to swipe early?</h2>
            <p className="mt-3 text-sm text-white/60 text-balance">
              Secure your spot with your Twitter handle and email.
            </p>
            <a
              href="/waitlist"
              className="mt-6 inline-flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-400 to-lime-300 px-8 py-4 text-sm font-semibold text-black shadow-lg shadow-cyan-500/30 transition hover:translate-y-[-1px]"
            >
              Join the waitlist
            </a>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-white/10 px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-sm text-white/60 md:flex-row">
          <p>© 2026 MemeSwipe. Built for Solana traders.</p>
          <div className="flex items-center gap-4">
            <a
              href="https://twitter.com/memeswipe89"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Twitter
            </a>
            <span className="text-white/30">•</span>
            <span className="font-mono text-xs text-white/50">v0.1</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
