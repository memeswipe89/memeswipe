import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  EmbeddedSolanaWalletState,
  useCreateGuestAccount,
  useEmbeddedSolanaWallet,
  usePrivy,
} from "@privy-io/expo";
import { Connection, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";

export type TwitterProfile = {
  id: string;
  username: string;
};

type WalletContextValue = {
  twitterProfile: TwitterProfile | null;
  walletAddress: string | null;
  tradingWalletAddress: string | null;
  walletLoading: boolean;
  walletError: string | null;
  setTwitterProfile: (profile: TwitterProfile | null) => void;
  getOrCreateLocalUserId: () => Promise<string>;
  getOrCreateEmbeddedWalletAddress: () => Promise<string>;
  getEmbeddedSolanaProvider: () => Promise<any>;
  exportEmbeddedPrivateKey: () => Promise<string>;
  refreshWalletAddress: () => Promise<string | null>;
  getOrCreateTradingWalletAddress: () => Promise<string>;
  withdrawFromTradingWallet: (amountSol: number, toAddress?: string) => Promise<{
    txSignature: string;
    withdrawnSol: number;
    remainingSol: number;
  }>;
};

const LOCAL_USER_ID_KEY = "@memeswipe:userId:v1";
const USER_ID_MAP_PREFIX = "@memeswipe:userId:privy:";
const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      setTradingWalletAddress(address);
      setWalletError(null);
      return;
    }
    // No active embedded wallet in current Privy session; clear stale local state.
    setWalletAddress(null);
    setTradingWalletAddress(null);
  }, [solanaWallet]);

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
      if (mapped && UUID_RE.test(mapped)) {
        if (existing !== mapped) await AsyncStorage.setItem(LOCAL_USER_ID_KEY, mapped);
        return mapped;
      }

      // Migrate legacy local id to Privy mapping when available.
      if (existing && UUID_RE.test(existing)) {
        await AsyncStorage.setItem(mapKey, existing);
        return existing;
      }

      const stable = createUuidV4();
      await AsyncStorage.setItem(mapKey, stable);
      await AsyncStorage.setItem(LOCAL_USER_ID_KEY, stable);
      return stable;
    }

    if (existing && UUID_RE.test(existing)) return existing;
    const next = createUuidV4();
    await AsyncStorage.setItem(LOCAL_USER_ID_KEY, next);
    return next;
  }, [user]);

  const getOrCreateTradingWalletAddress = async (): Promise<string> => {
    const embeddedWalletAddress = await getOrCreateEmbeddedWalletAddress();
    setTradingWalletAddress(embeddedWalletAddress);
    return embeddedWalletAddress;
  };

  const withdrawFromTradingWallet = async (amountSol: number, toAddress?: string) => {
    const destination = String(toAddress || "").trim();
    if (!destination) throw new Error("Destination wallet address is required");
    const lamports = Math.floor(Number(amountSol) * 1_000_000_000);
    if (!Number.isFinite(lamports) || lamports <= 0) throw new Error("Invalid withdraw amount");

    const fromAddress = await getOrCreateEmbeddedWalletAddress();
    if (!fromAddress) throw new Error("Embedded wallet not found");

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

    let signedTx: Transaction | null = null;

    if (provider && typeof provider.signTransaction === "function") {
      const signed = await provider.signTransaction({ transaction: tx });
      if (signed?.signedTransaction?.serialize) {
        signedTx = signed.signedTransaction as Transaction;
      }
    } else if (provider && typeof provider.request === "function") {
      const signed = await provider.request({
        method: "signTransaction",
        params: { transaction: tx },
      });
      if (signed?.signedTransaction?.serialize) {
        signedTx = signed.signedTransaction as Transaction;
      }
    }

    if (!signedTx) throw new Error("Embedded wallet could not sign withdraw transaction");
    const txSignature = await connection.sendRawTransaction(signedTx.serialize(), {
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

  const exportEmbeddedPrivateKey = async (): Promise<string> => {
    const provider = await getEmbeddedSolanaProvider();
    let response: any = null;

    if (provider && typeof provider.exportPrivateKey === "function") {
      response = await provider.exportPrivateKey();
    } else if (provider && typeof provider.request === "function") {
      try {
        response = await provider.request({ method: "exportPrivateKey" });
      } catch {
        response = await provider.request({ method: "exportPrivateKey", params: {} });
      }
    }

    const extracted =
      (typeof response === "string" ? response : null) ||
      response?.privateKey ||
      response?.private_key ||
      response?.data?.privateKey ||
      response?.data?.private_key ||
      response?.exportedPrivateKey ||
      null;

    if (typeof extracted !== "string" || !extracted.trim()) {
      throw new Error("Private key export is unavailable for this wallet.");
    }

    return extracted.trim();
  };

  const value = useMemo<WalletContextValue>(
    () => ({
      twitterProfile,
      walletAddress,
      tradingWalletAddress,
      walletLoading,
      walletError,
      setTwitterProfile,
      getOrCreateLocalUserId,
      getOrCreateEmbeddedWalletAddress,
      getEmbeddedSolanaProvider,
      exportEmbeddedPrivateKey,
      refreshWalletAddress,
      getOrCreateTradingWalletAddress,
      withdrawFromTradingWallet,
    }),
    [twitterProfile, walletAddress, tradingWalletAddress, walletLoading, walletError]
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
