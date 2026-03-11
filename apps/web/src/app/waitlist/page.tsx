'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function WaitlistPage() {
  const [walletAddress, setWalletAddress] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const isValidSolanaAddress = (address: string) => {
    const base58Regex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    return base58Regex.test(address);
  };

  const isValidEmail = (emailValue: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(emailValue);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!walletAddress.trim()) {
      alert('Please enter your wallet address.');
      return;
    }

    if (!isValidSolanaAddress(walletAddress.trim())) {
      alert('Please enter a valid Solana wallet address.');
      return;
    }

    if (!email.trim()) {
      alert('Please enter your email address.');
      return;
    }

    if (!isValidEmail(email.trim())) {
      alert('Please enter a valid email address.');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase.from('waitlist').insert({
        wallet_address: walletAddress.trim(),
        email: email.trim(),
      });

      if (error) throw error;

      setSubmitted(true);
    } catch (error) {
      console.error('Error submitting to waitlist:', error);
      alert('Failed to join waitlist. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden flex flex-col">
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-cyan-400/20 rounded-full animate-pulse"></div>
        <div className="absolute top-1/3 right-1/3 w-1 h-1 bg-lime-400/30 rounded-full animate-pulse delay-1000"></div>
        <div className="absolute bottom-1/3 left-1/3 w-1.5 h-1.5 bg-amber-400/20 rounded-full animate-pulse delay-500"></div>
        <div className="absolute top-2/3 right-1/4 w-1 h-1 bg-cyan-300/25 rounded-full animate-pulse delay-1500"></div>
        <div className="absolute bottom-1/4 right-1/2 w-2 h-2 bg-lime-300/15 rounded-full animate-pulse delay-2000"></div>
      </div>

      <section className="flex-1 flex flex-col items-center justify-center px-4 py-10 relative z-10">
        <div className="text-center max-w-2xl mx-auto space-y-6">
          <div className="space-y-3">
            <div className="w-12 h-12 bg-gradient-to-r from-cyan-400 to-lime-300 rounded-full mx-auto flex items-center justify-center text-black font-bold">
              MS
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-white">MemeSwipe</h2>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Early Access</p>
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl md:text-3xl font-light text-gray-200">
              Join the waitlist for
            </h1>
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-cyan-400 via-lime-400 to-cyan-500 bg-clip-text text-transparent">
              Tinder for Memecoins
            </h1>
          </div>

          {!submitted ? (
            <div className="w-full max-w-md pt-6 mx-auto space-y-4">
              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  type="text"
                  placeholder="Wallet Address"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  required
                  className="w-full px-4 py-4 bg-gray-900/50 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400 text-white placeholder-gray-400 text-center transition-all duration-300 hover:bg-gray-800/50"
                />

                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-4 bg-gray-900/50 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-cyan-400 text-white placeholder-gray-400 text-center transition-all duration-300 hover:bg-gray-800/50"
                />

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-gradient-to-r from-cyan-400 to-lime-300 text-black font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 hover:shadow-lg hover:shadow-cyan-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none text-lg"
                >
                  {loading ? 'Joining...' : 'Join Waitlist →'}
                </button>
              </form>
            </div>
          ) : (
            <div className="w-full max-w-md mx-auto space-y-3 text-center">
              <h2 className="text-2xl font-bold text-lime-300">You&apos;re on the MemeSwipe waitlist.</h2>
              <p className="text-gray-300">We&apos;ll notify you when early access opens.</p>
            </div>
          )}

          <a
            href="/landing"
            className="inline-flex items-center justify-center rounded-full border border-cyan-400/30 px-5 py-2 text-xs uppercase tracking-[0.25em] text-cyan-200/80 hover:border-cyan-300 hover:text-cyan-100 transition-colors"
          >
            More detail
          </a>
        </div>
      </section>

      <footer className="py-6 px-4 text-center relative z-10 text-sm text-gray-400">
        <p>Coming soon.</p>
        <a
          href="https://twitter.com/memeswipe89"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex text-cyan-200/80 hover:text-cyan-100 transition-colors"
        >
          Follow us on Twitter
        </a>
      </footer>
    </div>
  );
}
