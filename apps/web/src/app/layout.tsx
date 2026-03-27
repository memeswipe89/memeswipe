import type { Metadata } from "next";
import "./globals.css";
import { PwaInitializer } from "@/lib/pwa";

export const metadata: Metadata = {
  title: "Memeswipe",
  description: "Trade memecoins by swiping.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="apple-touch-icon" sizes="192x192" href="/icons/icon-192.png" />
        <link rel="apple-touch-icon" sizes="512x512" href="/icons/icon-512.png" />
        <meta name="theme-color" content="#7285ff" />
        <meta name="description" content="Swipe, rate, and trade Solana memecoins with a one-tap wallet." />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="shortcut icon" href="/favicon.ico" />
      </head>
        <body className="antialiased">
        <PwaInitializer />
        {children}
      </body>
    </html>
  );
}
