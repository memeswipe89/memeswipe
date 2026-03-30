import type { Metadata } from "next";
import "./globals.css";
import ClientProviders from "./ClientProviders";

export const metadata: Metadata = {
  title: "Memeswipe Web",
  description: "Crypto swipe trading built for mobile browsers and desktops.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white min-h-screen antialiased">
        <ClientProviders>{children}</ClientProviders>
      </body>
    </html>
  );
}
