import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type ChainType = 'solana' | 'base';

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

const STORAGE_KEY = '@memeswipe:trade-settings:v1';
const MIN_TRADE_AMOUNT_USD = 0.0001;
const MAX_TRADE_AMOUNT_USD = 500;
const MIN_PERCENT = 0.1;

const DEFAULT_SETTINGS = {
  profileName: 'Trader',
  tradeAmount: 10,
  tpROI: 50,
  stopLoss: 15,
  activeChain: 'solana' as ChainType,
};

const TradeSettingsContext = createContext<TradeSettingsState | undefined>(undefined);

// Safe merge-write: reads current stored value, merges patch, writes back
async function mergePersist(patch: Partial<typeof DEFAULT_SETTINGS>) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const existing = raw ? (JSON.parse(raw) as Partial<typeof DEFAULT_SETTINGS>) : {};
    const merged = { ...DEFAULT_SETTINGS, ...existing, ...patch };
    console.log('[TradeSettings] mergePersist patch:', patch, '=> merged:', merged);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch (err) {
    console.log('Failed to save settings', err);
  }
}

export function TradeSettingsProvider({ children }: { children: React.ReactNode }) {
  const [profileName, setProfileName] = useState(DEFAULT_SETTINGS.profileName);
  const [tradeAmount, setTradeAmount] = useState(DEFAULT_SETTINGS.tradeAmount);
  const [tpROI, setTpROI] = useState(DEFAULT_SETTINGS.tpROI);
  const [stopLoss, setStopLoss] = useState(DEFAULT_SETTINGS.stopLoss);
  const [activeChain, setActiveChain] = useState<ChainType>(DEFAULT_SETTINGS.activeChain);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate on mount
  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        console.log('[TradeSettings] hydrate raw:', raw);
        if (!raw || !active) return;
        const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_SETTINGS>;
        if (typeof parsed.profileName === 'string') setProfileName(parsed.profileName);
        if (typeof parsed.tradeAmount === 'number') setTradeAmount(parsed.tradeAmount);
        if (typeof parsed.tpROI === 'number') setTpROI(parsed.tpROI);
        if (typeof parsed.stopLoss === 'number') setStopLoss(parsed.stopLoss);
        if (parsed.activeChain === 'solana' || parsed.activeChain === 'base') {
          setActiveChain(parsed.activeChain);
        }
      } catch (err) {
        console.log('Failed to load settings', err);
      } finally {
        if (active) setHydrated(true);
      }
    };
    hydrate();
    return () => { active = false; };
  }, []);

  const setTradeAmountSafe = useCallback((value: number) => {
    const safe = Number.isFinite(value)
      ? Math.max(MIN_TRADE_AMOUNT_USD, Math.min(MAX_TRADE_AMOUNT_USD, value))
      : DEFAULT_SETTINGS.tradeAmount;
    setTradeAmount(safe);
    void mergePersist({ tradeAmount: safe });
  }, []);

  const setTpROISafe = useCallback((value: number) => {
    const safe = Number.isFinite(value) ? Math.max(MIN_PERCENT, value) : DEFAULT_SETTINGS.tpROI;
    setTpROI(safe);
    void mergePersist({ tpROI: safe });
  }, []);

  const setStopLossSafe = useCallback((value: number) => {
    const safe = Number.isFinite(value) ? Math.max(MIN_PERCENT, value) : DEFAULT_SETTINGS.stopLoss;
    setStopLoss(safe);
    void mergePersist({ stopLoss: safe });
  }, []);

  const setProfileNameSafe = useCallback((value: string) => {
    setProfileName(value);
    void mergePersist({ profileName: value });
  }, []);

  const setActiveChainSafe = useCallback((value: ChainType) => {
    setActiveChain(value);
    void mergePersist({ activeChain: value });
  }, []);

  const resetSettings = useCallback(() => {
    setProfileName(DEFAULT_SETTINGS.profileName);
    setTradeAmount(DEFAULT_SETTINGS.tradeAmount);
    setTpROI(DEFAULT_SETTINGS.tpROI);
    setStopLoss(DEFAULT_SETTINGS.stopLoss);
    setActiveChain(DEFAULT_SETTINGS.activeChain);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
  }, []);

  const value = useMemo(
    () => ({
      profileName,
      tradeAmount,
      tpROI,
      stopLoss,
      activeChain,
      hydrated,
      setProfileName: setProfileNameSafe,
      setTradeAmount: setTradeAmountSafe,
      setTpROI: setTpROISafe,
      setStopLoss: setStopLossSafe,
      setActiveChain: setActiveChainSafe,
      resetSettings,
    }),
    [
      activeChain, hydrated, profileName, resetSettings,
      setActiveChainSafe, setProfileNameSafe, setStopLossSafe,
      setTpROISafe, setTradeAmountSafe, stopLoss, tpROI, tradeAmount,
    ]
  );

  return <TradeSettingsContext.Provider value={value}>{children}</TradeSettingsContext.Provider>;
}

export function useTradeSettings() {
  const ctx = useContext(TradeSettingsContext);
  if (!ctx) {
    throw new Error('useTradeSettings must be used inside TradeSettingsProvider');
  }
  return ctx;
}
