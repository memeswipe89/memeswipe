import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePrivy } from '@/lib/privy-runtime';
import { getBalance } from '@/lib/checkBalance';

type AuthUser = {
  name: string;
  username: string;
};

type AuthContextState = {
  user: AuthUser | null;
  walletAddress: string | null;
  balance: number | null;
  requiresDeposit: boolean;
  balanceLoading: boolean;
  isLoggedIn: boolean;
  loading: boolean;
  refreshBalanceCheck: () => Promise<void>;
  logout: () => Promise<void>;
};

const AUTH_STORAGE_KEY = '@memeswipe:user:v1';
const WALLET_STORAGE_KEY = 'walletAddress';
const MIN_BALANCE = 1.5;
const ENFORCE_MIN_BALANCE = false;

const AuthContext = createContext<AuthContextState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user: privyUser, logout: privyLogout } = usePrivy();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [requiresDeposit, setRequiresDeposit] = useState(false);
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [loading, setLoading] = useState(true);

  const extractWalletAddress = useCallback((source: any): string | null => {
    const linked = Array.isArray(source?.linkedAccounts) ? source.linkedAccounts : [];
    const walletAccount =
      linked.find((a: any) => a?.type === 'wallet' && typeof a?.address === 'string') ||
      linked.find((a: any) => typeof a?.address === 'string');
    return walletAccount?.address || null;
  }, []);

  const refreshBalanceCheck = useCallback(async () => {
    const address = walletAddress || extractWalletAddress(privyUser);
    if (!address) {
      setBalance(null);
      setRequiresDeposit(false);
      return;
    }
    setBalanceLoading(true);
    try {
      const currentBalance = await getBalance(address);
      setBalance(currentBalance);
      setRequiresDeposit(ENFORCE_MIN_BALANCE ? currentBalance < MIN_BALANCE : false);
    } catch (err) {
      setBalance(null);
      setRequiresDeposit(false);
    } finally {
      setBalanceLoading(false);
    }
  }, [extractWalletAddress, privyUser, walletAddress]);

  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const [rawUser, rawWallet] = await Promise.all([
          AsyncStorage.getItem(AUTH_STORAGE_KEY),
          AsyncStorage.getItem(WALLET_STORAGE_KEY),
        ]);
        if (!active) return;
        if (rawUser) {
          const parsed = JSON.parse(rawUser) as AuthUser;
          if (parsed?.name && parsed?.username) setUser(parsed);
        }
        if (rawWallet) setWalletAddress(rawWallet);
      } catch (err) {
        // Failed to load auth state
      } finally {
        if (active) setLoading(false);
      }
    };

    hydrate();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const nextWallet = extractWalletAddress(privyUser);
    if (!nextWallet || nextWallet === walletAddress) return;
    setWalletAddress(nextWallet);
    void AsyncStorage.setItem(WALLET_STORAGE_KEY, nextWallet);
  }, [extractWalletAddress, privyUser, walletAddress]);

  useEffect(() => {
    if (!privyUser) return;
    const accountWithUsername =
      (privyUser as any)?.linkedAccounts?.find?.((a: any) => typeof a?.username === 'string') || null;
    const nextUser: AuthUser = {
      name: (privyUser as any)?.email?.address || 'Trader',
      username: accountWithUsername?.username ? `@${accountWithUsername.username}` : '@memeswipe',
    };
    setUser(nextUser);
    void AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextUser));
  }, [privyUser]);

  useEffect(() => {
    if (!user) {
      setRequiresDeposit(false);
      setBalance(null);
      return;
    }
    void refreshBalanceCheck();
  }, [refreshBalanceCheck, user]);

  const logout = useCallback(async () => {
    setUser(null);
    setWalletAddress(null);
    setBalance(null);
    setRequiresDeposit(false);
    await Promise.all([
      AsyncStorage.removeItem(AUTH_STORAGE_KEY),
      AsyncStorage.removeItem(WALLET_STORAGE_KEY),
      privyLogout(),
    ]);
  }, [privyLogout]);

  const value = useMemo(
    () => ({
      user,
      walletAddress,
      balance,
      requiresDeposit,
      balanceLoading,
      isLoggedIn: !!user,
      loading,
      refreshBalanceCheck,
      logout,
    }),
    [
      balance,
      balanceLoading,
      loading,
      logout,
      refreshBalanceCheck,
      requiresDeposit,
      user,
      walletAddress,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
