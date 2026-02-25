import * as FileSystem from "expo-file-system/legacy";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  EmbeddedSolanaWalletState,
  useCreateGuestAccount,
  useEmbeddedSolanaWallet,
  usePrivy,
} from "@privy-io/expo";

type WalletContextValue = {
  walletAddress: string | null;
  walletLoading: boolean;
  walletError: string | null;
  getOrCreateEmbeddedWalletAddress: () => Promise<string>;
  refreshWalletAddress: () => Promise<string | null>;
};

const WALLET_ADDRESS_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}memeswipe_wallet_address.txt`
  : null;

const WalletContext = createContext<WalletContextValue | null>(null);

const getAddressFromState = (state: EmbeddedSolanaWalletState): string | null => {
  if ("wallets" in state && Array.isArray(state.wallets) && state.wallets.length > 0) {
    return state.wallets[0]?.address || null;
  }

  if ("publicKey" in state && typeof state.publicKey === "string" && state.publicKey.length > 0) {
    return state.publicKey;
  }

  return null;
};

const getAddressFromProvider = (provider: unknown): string | null => {
  if (!provider || typeof provider !== "object") return null;
  const candidate = provider as { address?: string; publicKey?: unknown };

  if (typeof candidate.address === "string" && candidate.address.length > 0) {
    return candidate.address;
  }

  if (typeof candidate.publicKey === "string" && candidate.publicKey.length > 0) {
    return candidate.publicKey;
  }

  if (candidate.publicKey && typeof candidate.publicKey === "object") {
    const asStringFn = (candidate.publicKey as { toString?: () => string }).toString;
    if (typeof asStringFn === "function") {
      const value = asStringFn.call(candidate.publicKey);
      if (typeof value === "string" && value.length > 0) return value;
    }
  }

  return null;
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user, isReady } = usePrivy();
  const { create: createGuestAccount } = useCreateGuestAccount();
  const solanaWallet = useEmbeddedSolanaWallet();

  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const readyRef = useRef(isReady);
  const solanaRef = useRef(solanaWallet);

  useEffect(() => {
    readyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    solanaRef.current = solanaWallet;
    const address = getAddressFromState(solanaWallet);
    if (address) {
      setWalletAddress(address);
      setWalletError(null);
    }
  }, [solanaWallet]);

  useEffect(() => {
    (async () => {
      if (!WALLET_ADDRESS_FILE) return;

      try {
        const raw = await FileSystem.readAsStringAsync(WALLET_ADDRESS_FILE);
        const trimmed = raw.trim();
        if (trimmed) {
          setWalletAddress(trimmed);
        }
      } catch {
        // No cache yet.
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      if (!WALLET_ADDRESS_FILE) return;

      if (!walletAddress) {
        try {
          await FileSystem.deleteAsync(WALLET_ADDRESS_FILE, { idempotent: true });
        } catch {
          // Ignore cache cleanup errors.
        }
        return;
      }

      try {
        await FileSystem.writeAsStringAsync(WALLET_ADDRESS_FILE, walletAddress);
      } catch {
        // Ignore cache write errors.
      }
    })();
  }, [walletAddress]);

  const waitForPrivyReady = async () => {
    const startedAt = Date.now();
    while (!readyRef.current && Date.now() - startedAt < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    if (!readyRef.current) {
      throw new Error("Privy SDK is still loading. Please try again.");
    }
  };

  const ensurePrivyUser = async () => {
    if (user) return;
    await createGuestAccount();
  };

  const getOrCreateEmbeddedWalletAddress = async (): Promise<string> => {
    try {
      setWalletLoading(true);
      setWalletError(null);

      await waitForPrivyReady();
      await ensurePrivyUser();

      let address = getAddressFromState(solanaRef.current);
      if (address) {
        setWalletAddress(address);
        return address;
      }

      if ("create" in solanaRef.current && typeof solanaRef.current.create === "function") {
        const provider = await solanaRef.current.create();
        address = getAddressFromProvider(provider);
      }

      // Give state propagation a moment for wallets[] to update.
      for (let i = 0; !address && i < 10; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 150));
        address = getAddressFromState(solanaRef.current);
      }

      if (!address) {
        throw new Error("Could not create or fetch embedded Solana wallet address.");
      }

      setWalletAddress(address);
      return address;
    } catch (error: any) {
      const message = error?.message || "Failed to load wallet";
      setWalletError(message);
      throw error;
    } finally {
      setWalletLoading(false);
    }
  };

  const refreshWalletAddress = async () => {
    try {
      return await getOrCreateEmbeddedWalletAddress();
    } catch {
      return null;
    }
  };

  const value = useMemo<WalletContextValue>(
    () => ({
      walletAddress,
      walletLoading,
      walletError,
      getOrCreateEmbeddedWalletAddress,
      refreshWalletAddress,
    }),
    [walletAddress, walletLoading, walletError]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWalletContext() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWalletContext must be used inside WalletProvider");
  }
  return context;
}
