import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { EmbeddedSolanaWalletState } from "@privy-io/expo";
import { useEmbeddedSolanaWallet, usePrivy } from "@/lib/privy-runtime";
import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import { LOCAL_USER_ID_KEY, USER_ID_MAP_PREFIX, UUID_RE } from "@/lib/local-user-id";

export type TwitterProfile = {
  id: string;
  username: string;
};

type WithdrawResult = {
  txSignature: string;
  withdrawnSol: number;
  remainingSol: number;
};

type WalletContextValue = {
  privyUserId: string | null;
  twitterProfile: TwitterProfile | null;
  walletAddress: string | null;
  tradingWalletAddress: string | null;
  walletLoading: boolean;
  walletError: string | null;
  setTwitterProfile: (profile: TwitterProfile | null) => void;
  getOrCreateLocalUserId: () => Promise<string>;
  getOrCreateEmbeddedWalletAddress: () => Promise<string>;
  getEmbeddedSolanaProvider: () => Promise<any>;
  refreshWalletAddress: () => Promise<string | null>;
  getOrCreateTradingWalletAddress: () => Promise<string>;
  withdrawFromTradingWallet: (
    amountSol: number,
    toAddress?: string
  ) => Promise<WithdrawResult>;
};

const SOLANA_MAINNET_RPC = "https://api.mainnet-beta.solana.com";

const WalletContext = createContext<WalletContextValue | null>(null);

const getAddressFromState = (
  state: EmbeddedSolanaWalletState | null | undefined
): string | null => {
  if (!state) return null;

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

  const candidate = provider as {
    address?: string;
    publicKey?: unknown;
  };

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
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }

  return null;
};

const createUuidV4 = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const rand = Math.floor(Math.random() * 16);
    const value = ch === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });

const getLinkedAccounts = (privyUser: any): any[] => {
  if (!privyUser) return [];
  if (Array.isArray(privyUser?.linked_accounts)) return privyUser.linked_accounts;
  if (Array.isArray(privyUser?.linkedAccounts)) return privyUser.linkedAccounts;
  return [];
};

const getTwitterFromPrivy = (privyUser: any): TwitterProfile | null => {
  if (!privyUser) return null;
  const linked = getLinkedAccounts(privyUser);
  const twitter = linked.find((account: any) => account?.type === "twitter_oauth");
  if (!twitter) {
    const legacy = privyUser?.twitter;
    if (legacy && typeof legacy?.subject === "string" && typeof legacy?.username === "string") {
      return { id: legacy.subject, username: legacy.username };
    }
    return null;
  }
  const username =
    typeof twitter?.username === "string"
      ? twitter.username
      : typeof twitter?.handle === "string"
        ? twitter.handle
        : null;
  const id =
    typeof twitter?.subject === "string"
      ? twitter.subject
      : typeof twitter?.id === "string"
        ? twitter.id
        : null;
  if (!username || !id) return null;
  return { username, id };
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user, isReady } = usePrivy();
  const solanaWallet = useEmbeddedSolanaWallet();

  const [twitterProfile, setTwitterProfile] = useState<TwitterProfile | null>(null);
  const [privyUserId, setPrivyUserId] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [tradingWalletAddress, setTradingWalletAddress] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);

  const readyRef = useRef(isReady);
  const userRef = useRef(user);
  const solanaRef = useRef(solanaWallet);

  useEffect(() => {
    readyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    userRef.current = user;
    setPrivyUserId(typeof (user as any)?.id === "string" ? ((user as any).id as string) : null);
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const profile = getTwitterFromPrivy(user);
    if (!profile) return;
    setTwitterProfile((prev) => {
      if (prev?.id === profile.id && prev?.username === profile.username) return prev;
      return profile;
    });
  }, [user]);

  useEffect(() => {
    solanaRef.current = solanaWallet;
  }, [solanaWallet]);

  // Hydrate wallet address from Privy session when available.
  useEffect(() => {
    if (!isReady) return;

    const address = getAddressFromState(solanaWallet);

    if (address) {
      setWalletAddress(address);
      setTradingWalletAddress(address);
      setWalletError(null);
      return;
    }

    // Important:
    // Do NOT clear wallet immediately while Privy is hydrating or wallet state
    // hasn't propagated yet. Only clear if Privy is ready and there is no user.
    if (!user) {
      setWalletAddress(null);
      setTradingWalletAddress(null);
      setWalletError(null);
    }
  }, [isReady, user, solanaWallet]);

  const waitForPrivyReady = useCallback(async () => {
    const startedAt = Date.now();

    while (!readyRef.current && Date.now() - startedAt < 10000) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    if (!readyRef.current) {
      throw new Error("Privy SDK is still loading. Please try again.");
    }
  }, []);

  const requirePrivyUser = useCallback(async () => {
    await waitForPrivyReady();

    if (!userRef.current) {
      throw new Error("Privy login required. Please connect and try again.");
    }
  }, [waitForPrivyReady]);

  const getOrCreateLocalUserId = useCallback(async (): Promise<string> => {
    const privyUserId =
      typeof (user as any)?.id === "string" ? ((user as any).id as string) : null;

    const existing = await AsyncStorage.getItem(LOCAL_USER_ID_KEY);

    if (privyUserId) {
      const mapKey = `${USER_ID_MAP_PREFIX}${privyUserId}`;
      const mapped = await AsyncStorage.getItem(mapKey);

      if (mapped && UUID_RE.test(mapped)) {
        if (existing !== mapped) {
          await AsyncStorage.setItem(LOCAL_USER_ID_KEY, mapped);
        }
        return mapped;
      }

      const stable = createUuidV4();
      await AsyncStorage.setItem(mapKey, stable);
      await AsyncStorage.setItem(LOCAL_USER_ID_KEY, stable);
      return stable;
    }

    if (existing && UUID_RE.test(existing)) {
      return existing;
    }

    const next = createUuidV4();
    await AsyncStorage.setItem(LOCAL_USER_ID_KEY, next);
    return next;
  }, [user]);

  const getOrCreateEmbeddedWalletAddress = useCallback(async (): Promise<string> => {
    try {
      setWalletLoading(true);
      setWalletError(null);

      await requirePrivyUser();

      let address = getAddressFromState(solanaRef.current);

      if (address) {
        setWalletAddress(address);
        setTradingWalletAddress(address);
        return address;
      }

      if (
        solanaRef.current &&
        "create" in solanaRef.current &&
        typeof solanaRef.current.create === "function"
      ) {
        const provider = await solanaRef.current.create();
        address = getAddressFromProvider(provider);
      }

      // Give Privy time to propagate wallet state.
      for (let i = 0; !address && i < 15; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        address = getAddressFromState(solanaRef.current);
      }

      if (!address) {
        throw new Error("Could not create or fetch embedded Solana wallet address.");
      }

      setWalletAddress(address);
      setTradingWalletAddress(address);
      setWalletError(null);

      return address;
    } catch (error: any) {
      const message = error?.message || "Failed to load wallet";
      setWalletError(message);
      throw error;
    } finally {
      setWalletLoading(false);
    }
  }, [requirePrivyUser]);

  const refreshWalletAddress = useCallback(async (): Promise<string | null> => {
    try {
      return await getOrCreateEmbeddedWalletAddress();
    } catch {
      return null;
    }
  }, [getOrCreateEmbeddedWalletAddress]);

  const getOrCreateTradingWalletAddress = useCallback(async (): Promise<string> => {
    const embeddedWalletAddress = await getOrCreateEmbeddedWalletAddress();
    setTradingWalletAddress(embeddedWalletAddress);
    return embeddedWalletAddress;
  }, [getOrCreateEmbeddedWalletAddress]);

  const getEmbeddedSolanaProvider = useCallback(async (): Promise<any> => {
    await requirePrivyUser();

    const wallets =
      solanaRef.current && "wallets" in solanaRef.current
        ? solanaRef.current.wallets
        : null;

    if (
      Array.isArray(wallets) &&
      wallets.length > 0 &&
      typeof wallets[0]?.getProvider === "function"
    ) {
      return wallets[0].getProvider();
    }

    if (
      solanaRef.current &&
      "getProvider" in solanaRef.current &&
      typeof solanaRef.current.getProvider === "function"
    ) {
      return solanaRef.current.getProvider();
    }

    if (
      solanaRef.current &&
      "create" in solanaRef.current &&
      typeof solanaRef.current.create === "function"
    ) {
      const provider = await solanaRef.current.create();
      if (provider) {
        return provider;
      }
    }

    throw new Error("Privy Solana provider unavailable");
  }, [requirePrivyUser]);

  const withdrawFromTradingWallet = useCallback(
    async (amountSol: number, toAddress?: string): Promise<WithdrawResult> => {
      const destination = String(toAddress || "").trim();
      if (!destination) {
        throw new Error("Destination wallet address is required");
      }

      const lamports = Math.floor(Number(amountSol) * 1_000_000_000);
      if (!Number.isFinite(lamports) || lamports <= 0) {
        throw new Error("Invalid withdraw amount");
      }

      const fromAddress = await getOrCreateEmbeddedWalletAddress();
      if (!fromAddress) {
        throw new Error("Embedded wallet not found");
      }

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

      if (!signedTx) {
        throw new Error("Embedded wallet could not sign withdraw transaction");
      }

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
    },
    [getEmbeddedSolanaProvider, getOrCreateEmbeddedWalletAddress]
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      privyUserId,
      twitterProfile,
      walletAddress,
      tradingWalletAddress,
      walletLoading,
      walletError,
      setTwitterProfile,
      getOrCreateLocalUserId,
      getOrCreateEmbeddedWalletAddress,
      getEmbeddedSolanaProvider,
      refreshWalletAddress,
      getOrCreateTradingWalletAddress,
      withdrawFromTradingWallet,
    }),
    [
      privyUserId,
      twitterProfile,
      walletAddress,
      tradingWalletAddress,
      walletLoading,
      walletError,
      getOrCreateLocalUserId,
      getOrCreateEmbeddedWalletAddress,
      getEmbeddedSolanaProvider,
      refreshWalletAddress,
      getOrCreateTradingWalletAddress,
      withdrawFromTradingWallet,
    ]
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
