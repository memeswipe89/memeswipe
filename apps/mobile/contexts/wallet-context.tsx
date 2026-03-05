import * as FileSystem from "expo-file-system/legacy";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  EmbeddedSolanaWalletState,
  useCreateGuestAccount,
  useEmbeddedSolanaWallet,
  usePrivy,
} from "@privy-io/expo";
import { Buffer } from "buffer";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

export type TwitterProfile = {
  id: string;
  username: string;
};

type WalletContextValue = {
  twitterProfile: TwitterProfile | null;
  walletAddress: string | null;
  tradingWalletAddress: string | null;
  withdrawAddress: string | null;
  walletLoading: boolean;
  walletError: string | null;
  setTwitterProfile: (profile: TwitterProfile | null) => void;
  getOrCreateLocalUserId: () => Promise<string>;
  getOrCreateEmbeddedWalletAddress: () => Promise<string>;
  getEmbeddedSolanaProvider: () => Promise<any>;
  refreshWalletAddress: () => Promise<string | null>;
  getOrCreateTradingWalletAddress: () => Promise<string>;
  setTradingWithdrawAddress: (address: string) => Promise<string>;
  withdrawFromTradingWallet: (amountSol: number, toAddress?: string) => Promise<{
    txSignature: string;
    withdrawnSol: number;
    remainingSol: number;
  }>;
};

const WALLET_ADDRESS_FILE = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}memeswipe_wallet_address.txt`
  : null;
const LOCAL_USER_ID_KEY = "@memeswipe:userId:v1";
const USER_ID_MAP_PREFIX = "@memeswipe:userId:privy:";
const API_BASE = process.env.EXPO_PUBLIC_API_BASE || "https://memeswipe.onrender.com";
const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

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

  const [twitterProfile, setTwitterProfile] = useState<TwitterProfile | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [tradingWalletAddress, setTradingWalletAddress] = useState<string | null>(null);
  const [withdrawAddress, setWithdrawAddress] = useState<string | null>(null);
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

  const createUuidV4 = () =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
      const rand = Math.floor(Math.random() * 16);
      const value = ch === "x" ? rand : (rand & 0x3) | 0x8;
      return value.toString(16);
    });

  const getOrCreateLocalUserId = useCallback(async () => {
    const privyUserId = typeof (user as any)?.id === "string" ? ((user as any).id as string) : null;
    const existing = await AsyncStorage.getItem(LOCAL_USER_ID_KEY);

    // Prefer stable mapping by Privy user id to avoid wallet changes across reinstalls.
    if (privyUserId) {
      const mapKey = `${USER_ID_MAP_PREFIX}${privyUserId}`;
      const mapped = await AsyncStorage.getItem(mapKey);
      if (mapped) {
        if (existing !== mapped) await AsyncStorage.setItem(LOCAL_USER_ID_KEY, mapped);
        return mapped;
      }

      // Migrate legacy local id to Privy mapping when available.
      if (existing) {
        await AsyncStorage.setItem(mapKey, existing);
        return existing;
      }

      const stable = createUuidV4();
      await AsyncStorage.setItem(mapKey, stable);
      await AsyncStorage.setItem(LOCAL_USER_ID_KEY, stable);
      return stable;
    }

    if (existing) return existing;
    const next = createUuidV4();
    await AsyncStorage.setItem(LOCAL_USER_ID_KEY, next);
    return next;
  }, [user]);

  const getOrCreateTradingWalletAddress = async (): Promise<string> => {
    setWalletLoading(true);
    setWalletError(null);
    try {
      const userId = await getOrCreateLocalUserId();
      const embeddedWalletAddress = await getOrCreateEmbeddedWalletAddress();
      const res = await fetch(`${API_BASE}/api/trading-wallet/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, walletAddress: embeddedWalletAddress }),
      });
      const json = (await res.json()) as {
        error?: string;
        walletAddress?: string;
        withdrawAddress?: string | null;
      };
      if (!res.ok || !json?.walletAddress) {
        throw new Error(json?.error || "Failed to create trading wallet");
      }
      setTradingWalletAddress(json.walletAddress);
      setWithdrawAddress(json.withdrawAddress || null);
      return json.walletAddress;
    } catch (error: any) {
      const message = error?.message || "Failed to create trading wallet";
      setWalletError(message);
      throw error;
    } finally {
      setWalletLoading(false);
    }
  };

  const setTradingWithdrawAddress = async (address: string): Promise<string> => {
    const userId = await getOrCreateLocalUserId();
    const res = await fetch(`${API_BASE}/api/trading-wallet/withdraw-address`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, withdrawAddress: address }),
    });
    const json = (await res.json()) as { error?: string; withdrawAddress?: string; walletAddress?: string };
    if (!res.ok || !json?.withdrawAddress) {
      throw new Error(json?.error || "Failed to update withdraw address");
    }
    if (json.walletAddress) setTradingWalletAddress(json.walletAddress);
    setWithdrawAddress(json.withdrawAddress);
    return json.withdrawAddress;
  };

  const withdrawFromTradingWallet = async (amountSol: number, toAddress?: string) => {
    const destination = String(toAddress || "").trim();
    if (!destination) throw new Error("Destination wallet address is required");
    const lamports = Math.floor(Number(amountSol) * 1_000_000_000);
    if (!Number.isFinite(lamports) || lamports <= 0) throw new Error("Invalid withdraw amount");

    const fromAddress = tradingWalletAddress || (await getOrCreateTradingWalletAddress());
    if (!fromAddress) throw new Error("Trading wallet not found");

    const connection = new Connection(SOLANA_MAINNET_RPC, "confirmed");
    const provider = await getEmbeddedSolanaProvider();
    const fromPubkey = new PublicKey(fromAddress);
    const toPubkey = new PublicKey(destination);

    const { blockhash } = await connection.getLatestBlockhash("finalized");
    const tx = new Transaction({
      feePayer: fromPubkey,
      recentBlockhash: blockhash,
    }).add(
      SystemProgram.transfer({
        fromPubkey,
        toPubkey,
        lamports,
      })
    );

    const unsignedTxBytes = tx.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });
    const requestBytes = Uint8Array.from(unsignedTxBytes);
    let signedTxBytes: Uint8Array | null = null;

    if (provider && typeof provider.signTransaction === "function") {
      const signed = await provider.signTransaction({ transaction: requestBytes });
      signedTxBytes = signed?.signedTransaction ? Uint8Array.from(signed.signedTransaction) : null;
    } else if (provider && typeof provider.request === "function") {
      const signed = await provider.request({
        method: "signTransaction",
        params: { transaction: requestBytes },
      });
      signedTxBytes = signed?.signedTransaction ? Uint8Array.from(signed.signedTransaction) : null;
    }

    if (!signedTxBytes) throw new Error("Embedded wallet could not sign withdraw transaction");
    const txSignature = await connection.sendRawTransaction(Buffer.from(signedTxBytes), {
      skipPreflight: false,
      maxRetries: 3,
    });
    await connection.confirmTransaction(txSignature, "confirmed");
    const remainingLamports = await connection.getBalance(fromPubkey, "confirmed");

    return {
      txSignature,
      withdrawnSol: Number(amountSol),
      remainingSol: Number(remainingLamports / 1_000_000_000),
    };
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const userId = await getOrCreateLocalUserId();
        const res = await fetch(`${API_BASE}/api/trading-wallet/${encodeURIComponent(userId)}`);
        if (!res.ok) return;
        const json = (await res.json()) as { walletAddress?: string; withdrawAddress?: string | null };
        if (!active) return;
        if (json.walletAddress) {
          setTradingWalletAddress(json.walletAddress);
        }
        if (typeof json.withdrawAddress === "string" && json.withdrawAddress.length > 0) {
          setWithdrawAddress(json.withdrawAddress);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      active = false;
    };
  }, []);

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
    try {
      await createGuestAccount();
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      // Privy can throw this if session exists but local hook state is briefly stale.
      if (message.includes('already logged in') && message.includes('guest account')) {
        return;
      }
      throw error;
    }
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

  const getEmbeddedSolanaProvider = async () => {
    await waitForPrivyReady();
    await ensurePrivyUser();

    const wallets = "wallets" in solanaRef.current ? solanaRef.current.wallets : null;
    if (Array.isArray(wallets) && wallets.length > 0 && typeof wallets[0]?.getProvider === "function") {
      return wallets[0].getProvider();
    }

    if ("getProvider" in solanaRef.current && typeof solanaRef.current.getProvider === "function") {
      return solanaRef.current.getProvider();
    }

    if ("create" in solanaRef.current && typeof solanaRef.current.create === "function") {
      const provider = await solanaRef.current.create();
      if (provider) return provider;
    }

    throw new Error("Privy Solana provider unavailable");
  };

  const value = useMemo<WalletContextValue>(
    () => ({
      twitterProfile,
      walletAddress,
      tradingWalletAddress,
      withdrawAddress,
      walletLoading,
      walletError,
      setTwitterProfile,
      getOrCreateLocalUserId,
      getOrCreateEmbeddedWalletAddress,
      getEmbeddedSolanaProvider,
      refreshWalletAddress,
      getOrCreateTradingWalletAddress,
      setTradingWithdrawAddress,
      withdrawFromTradingWallet,
    }),
    [twitterProfile, walletAddress, tradingWalletAddress, withdrawAddress, walletLoading, walletError]
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
