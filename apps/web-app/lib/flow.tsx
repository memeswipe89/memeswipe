"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getDisplayNameFromUser, getSolanaWalletAddressFromUser } from "./privy-utils";

type FlowStage = "auth" | "wallet" | "ready";

type FlowState = {
  stage: FlowStage;
  userId: string | null;
  displayName: string;
  walletAddress: string | null;
  loading: boolean;
  error: string | null;
};

type FlowContextValue = FlowState & {
  loginWithTwitter: () => void;
  loginWithEmail: () => void;
  createWallet: () => Promise<void>;
  resetFlow: () => Promise<void>;
};

const defaultState: FlowState = {
  stage: "auth",
  userId: null,
  displayName: "Trader",
  walletAddress: null,
  loading: false,
  error: null,
};

const FlowContext = createContext<FlowContextValue | undefined>(undefined);

export function FlowProvider({ children }: { children: ReactNode }) {
  const privy = usePrivy();
  const [state, setState] = useState<FlowState>(defaultState);

  useEffect(() => {
    if (!privy.ready) return;

    if (!privy.authenticated) {
      setState((prev) => ({ ...prev, ...defaultState }));
      return;
    }

    const walletAddress = getSolanaWalletAddressFromUser(privy.user);
    const displayName = getDisplayNameFromUser(privy.user);
    const stage: FlowStage = walletAddress ? "ready" : "wallet";
    setState((prev) => ({
      ...prev,
      stage,
      userId: privy.user?.id ?? null,
      walletAddress,
      displayName,
      loading: false,
      error: null,
    }));
  }, [privy.authenticated, privy.ready, privy.user]);

  const loginWithMethod = useCallback(
    (method: "twitter" | "email") => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      if (!privy.ready) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: "Privy is still loading. Please try again in a moment.",
        }));
        return;
      }
      try {
        privy.login({
          loginMethods: [method],
        });
      } catch (error) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: `Unable to launch ${method} w/ Privy. Try again.`,
        }));
      }
    },
    [privy]
  );

  const loginWithTwitter = useCallback(() => loginWithMethod("twitter"), [loginWithMethod]);
  const loginWithEmail = useCallback(() => loginWithMethod("email"), [loginWithMethod]);

  const createWallet = useCallback(async () => {
    if (!privy.authenticated) {
      setState((prev) => ({ ...prev, error: "Login required to create a wallet." }));
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      await privy.connectOrCreateWallet();
    } catch (error) {
      setState((prev) => ({
        ...prev,
        error: "Unable to link an embedded wallet yet. Give it a second and try again.",
      }));
    } finally {
      setState((prev) => ({ ...prev, loading: false }));
    }
  }, [privy]);

  const resetFlow = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      await privy.logout();
    } finally {
      setState(defaultState);
    }
  }, [privy]);

  const value = useMemo(
    () => ({
      ...state,
      loginWithTwitter,
      loginWithEmail,
      createWallet,
      resetFlow,
    }),
    [state, loginWithEmail, loginWithTwitter, createWallet, resetFlow]
  );

  return <FlowContext.Provider value={value}>{children}</FlowContext.Provider>;
}

export function useFlow() {
  const context = useContext(FlowContext);
  if (!context) {
    throw new Error("useFlow must be used within FlowProvider");
  }
  return context;
}
