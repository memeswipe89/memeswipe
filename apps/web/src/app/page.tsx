'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Home() {
  const [walletAddress, setWalletAddress] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Additional validation
    if (!walletAddress.trim()) {
      alert('Please enter your wallet address.');
      return;
    }
    if (!email.trim()) {
      alert('Please enter your email address.');
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
    <div className="h-screen bg-black text-white font-sans relative overflow-hidden flex flex-col">
      {/* Background particles */}
      <div className="absolute inset-0">
        <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-blue-400/20 rounded-full animate-pulse"></div>
        <div className="absolute top-1/3 right-1/3 w-1 h-1 bg-green-400/30 rounded-full animate-pulse delay-1000"></div>
        <div className="absolute bottom-1/3 left-1/3 w-1.5 h-1.5 bg-purple-400/20 rounded-full animate-pulse delay-500"></div>
        <div className="absolute top-2/3 right-1/4 w-1 h-1 bg-blue-300/25 rounded-full animate-pulse delay-1500"></div>
        <div className="absolute bottom-1/4 right-1/2 w-2 h-2 bg-green-300/15 rounded-full animate-pulse delay-2000"></div>
      </div>
      {/* Hero Section */}
      <section className="flex-1 flex flex-col items-center justify-center px-4 py-8 relative z-10">
        <div className="text-center max-w-2xl mx-auto space-y-4">
          {/* Logo and Early Access */}
          <div className="space-y-3">
            <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-green-500 rounded-full mx-auto flex items-center justify-center">
              <span className="text-xl font-bold text-white">M</span>
            </div>
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-white">MemeSwipe</h2>
              <p className="text-xs text-gray-400 uppercase tracking-wider">Early Access</p>
            </div>
          </div>

          {/* Main Headline */}
          <div className="space-y-1">
            <h1 className="text-2xl md:text-2xl font-light text-gray-200">
              Join the waitlist for
            </h1>
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-blue-400 via-green-400 to-blue-500 bg-clip-text text-transparent">
             Tinder for Memecoins
            </h1>
          </div>

          {/* Subtext */}
          <div className="space-y-1 max-w-lg mx-auto">
            {/* <p className="text-base text-gray-300 leading-relaxed">
              Discover memecoins before they trend.
            </p>
            <p className="text-base text-gray-300 leading-relaxed">
              Set Take Profit. Set Stop Loss.
            </p>
            <p className="text-base text-gray-300 leading-relaxed">
              Swipe right to buy. Swipe left to skip.
            </p> */}
          </div>
          {/* Waitlist Form */}
          {!submitted ? (
            <div className="w-full max-w-md pt-8 mx-auto space-y-4">
              <form onSubmit={handleSubmit} className="space-y-4">
                <input
                  type="text"
                  placeholder="Wallet Address"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  required
                  className="w-full px-4 py-4 bg-gray-900/50 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-400 text-center transition-all duration-300 hover:bg-gray-800/50"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-4 bg-gray-900/50 border border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-white placeholder-gray-400 text-center transition-all duration-300 hover:bg-gray-800/50"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-4 bg-gradient-to-r from-blue-500 to-green-500 hover:from-blue-600 hover:to-green-600 text-white font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 hover:shadow-lg hover:shadow-blue-500/25 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none text-lg"
                >
                  {loading ? 'Joining...' : 'Join Waitlist →'}
                </button>
              </form>
            </div>
          ) : (
            <div className="w-full max-w-md mx-auto space-y-4 text-center">
              <h2 className="text-2xl font-bold text-green-400">You&apos;re on the MemeSwipe waitlist.</h2>
              <p className="text-gray-300">We&apos;ll notify you when early access opens.</p>
            </div>
          )}
        </div>
      </section>

      {/* Footer */}
      <footer className="py-4 px-4 text-center relative z-10">
        <p className="text-gray-400 mb-4">Coming soon...</p>
        <a
          href="https://twitter.com/MemeSwipe"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 transition-colors"
        >
          Follow us on Twitter
        </a>
      </footer>
    </div>
  );
}
