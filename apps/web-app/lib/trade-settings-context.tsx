"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ChainType = "solana" | "base";

type TradeSettingsState = {
  profileName: string;
  tradeAmount: number;
  tpROI: number;
  stopLoss: number;
  activeChain: ChainType;
  hydrated: boolean;
  setProfileName: (value: string) => void;
  setTradeAmount: (value: number) => void;
  setTpROI: (value: number) => void;
  setStopLoss: (value: number) => void;
  setActiveChain: (value: ChainType) => void;
  resetSettings: () => void;
};

const STORAGE_KEY = "memeswipe:web-trade-settings:v1";
const MIN_TRADE_AMOUNT = 0.0001;
const MAX_TRADE_AMOUNT = 500;
const MIN_PERCENT = 0.1;

const DEFAULT_SETTINGS = {
  profileName: "Trader",
  tradeAmount: 10,
  tpROI: 50,
  stopLoss: 15,
  activeChain: "solana" as ChainType,
};

const TradeSettingsContext = createContext<TradeSettingsState | undefined>(undefined);

export function TradeSettingsProvider({ children }: { children: React.ReactNode }) {
  const [profileName, setProfileName] = useState(DEFAULT_SETTINGS.profileName);
  const [tradeAmount, setTradeAmount] = useState(DEFAULT_SETTINGS.tradeAmount);
  const [tpROI, setTpROI] = useState(DEFAULT_SETTINGS.tpROI);
  const [stopLoss, setStopLoss] = useState(DEFAULT_SETTINGS.stopLoss);
  const [activeChain, setActiveChain] = useState<ChainType>(DEFAULT_SETTINGS.activeChain);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let mounted = true;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setHydrated(true);
      return;
    }
    try {
      const parsed = JSON.parse(stored);
      if (mounted) {
        if (typeof parsed.profileName === "string") setProfileName(parsed.profileName);
        if (typeof parsed.tradeAmount === "number") setTradeAmount(parsed.tradeAmount);
        if (typeof parsed.tpROI === "number") setTpROI(parsed.tpROI);
        if (typeof parsed.stopLoss === "number") setStopLoss(parsed.stopLoss);
        if (parsed.activeChain === "solana" || parsed.activeChain === "base") {
          setActiveChain(parsed.activeChain);
        }
      }
    } catch (error) {
      console.warn("Failed to parse trade settings", error);
    } finally {
      if (mounted) {
        setHydrated(true);
      }
    }
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const handler = () => {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ profileName, tradeAmount, tpROI, stopLoss, activeChain })
        );
      } catch (error) {
        console.warn("Failed to persist trade settings", error);
      }
    };
    const timer = window.setTimeout(handler, 120);
    return () => window.clearTimeout(timer);
  }, [activeChain, hydrated, profileName, stopLoss, tpROI, tradeAmount]);

  const setTradeAmountSafe = useCallback((value: number) => {
    const normalized = Number.isFinite(value) ? Math.max(MIN_TRADE_AMOUNT, Math.min(MAX_TRADE_AMOUNT, value)) : DEFAULT_SETTINGS.tradeAmount;
    setTradeAmount(normalized);
  }, []);

  const setTpROISafe = useCallback((value: number) => {
    setTpROI(Number.isFinite(value) ? Math.max(MIN_PERCENT, value) : DEFAULT_SETTINGS.tpROI);
  }, []);

  const setStopLossSafe = useCallback((value: number) => {
    setStopLoss(Number.isFinite(value) ? Math.max(MIN_PERCENT, value) : DEFAULT_SETTINGS.stopLoss);
  }, []);

  const resetSettings = useCallback(() => {
    setProfileName(DEFAULT_SETTINGS.profileName);
    setTradeAmount(DEFAULT_SETTINGS.tradeAmount);
    setTpROI(DEFAULT_SETTINGS.tpROI);
    setStopLoss(DEFAULT_SETTINGS.stopLoss);
    setActiveChain(DEFAULT_SETTINGS.activeChain);
  }, []);

  const value = useMemo(
    () => ({
      profileName,
      tradeAmount,
      tpROI,
      stopLoss,
      activeChain,
      hydrated,
      setProfileName,
      setTradeAmount: setTradeAmountSafe,
      setTpROI: setTpROISafe,
      setStopLoss: setStopLossSafe,
      setActiveChain,
      resetSettings,
    }),
    [
      activeChain,
      hydrated,
      profileName,
      resetSettings,
      setActiveChain,
      setStopLossSafe,
      setTpROISafe,
      setTradeAmountSafe,
      stopLoss,
      tpROI,
      tradeAmount,
    ]
  );

  return <TradeSettingsContext.Provider value={value}>{children}</TradeSettingsContext.Provider>;
}

export function useTradeSettings() {
  const context = useContext(TradeSettingsContext);
  if (!context) {
    throw new Error("useTradeSettings must be used inside TradeSettingsProvider");
  }
  return context;
}
