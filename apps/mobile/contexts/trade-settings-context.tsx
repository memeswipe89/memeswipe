import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

export type ChainType = 'solana' | 'base';

type TradeSettingsState = {
  profileName: string;
  tradeAmount: number;
  tpROI: number;
  stopLoss: number;
  activeChain: ChainType;
  showDisclaimer: boolean;
  hydrated: boolean;
  setProfileName: (value: string) => void;
  setTradeAmount: (value: number) => void;
  setTpROI: (value: number) => void;
  setStopLoss: (value: number) => void;
  setActiveChain: (value: ChainType) => void;
  setShowDisclaimer: (value: boolean) => void;
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
  showDisclaimer: true,
};

const TradeSettingsContext = createContext<TradeSettingsState | undefined>(undefined);

// Safe merge-write: reads current stored value, merges patch, writes back
async function mergePersist(patch: Partial<typeof DEFAULT_SETTINGS>) {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const existing = raw ? (JSON.parse(raw) as Partial<typeof DEFAULT_SETTINGS>) : {};
    const merged = { ...DEFAULT_SETTINGS, ...existing, ...patch };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // ignore — settings will use in-memory values
  }
}

export function TradeSettingsProvider({ children }: { children: React.ReactNode }) {
  const [profileName, setProfileName] = useState(DEFAULT_SETTINGS.profileName);
  const [tradeAmount, setTradeAmount] = useState(DEFAULT_SETTINGS.tradeAmount);
  const [tpROI, setTpROI] = useState(DEFAULT_SETTINGS.tpROI);
  const [stopLoss, setStopLoss] = useState(DEFAULT_SETTINGS.stopLoss);
  const [activeChain, setActiveChain] = useState<ChainType>(DEFAULT_SETTINGS.activeChain);
  const [showDisclaimer, setShowDisclaimer] = useState(DEFAULT_SETTINGS.showDisclaimer);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate on mount
  useEffect(() => {
    let active = true;
    const hydrate = async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (!raw || !active) return;
        const parsed = JSON.parse(raw) as Partial<typeof DEFAULT_SETTINGS>;
        if (typeof parsed.profileName === 'string') setProfileName(parsed.profileName);
        if (typeof parsed.tradeAmount === 'number') setTradeAmount(parsed.tradeAmount);
        if (typeof parsed.tpROI === 'number') setTpROI(parsed.tpROI);
        if (typeof parsed.stopLoss === 'number') setStopLoss(parsed.stopLoss);
        if (typeof parsed.showDisclaimer === 'boolean') setShowDisclaimer(parsed.showDisclaimer);
        if (parsed.activeChain === 'solana' || parsed.activeChain === 'base') {
          setActiveChain(parsed.activeChain);
        }
      } catch {
        // ignore — defaults will be used
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

  const setShowDisclaimerSafe = useCallback((value: boolean) => {
    setShowDisclaimer(value);
    void mergePersist({ showDisclaimer: value });
  }, []);

  const resetSettings = useCallback(() => {
    setProfileName(DEFAULT_SETTINGS.profileName);
    setTradeAmount(DEFAULT_SETTINGS.tradeAmount);
    setTpROI(DEFAULT_SETTINGS.tpROI);
    setStopLoss(DEFAULT_SETTINGS.stopLoss);
    setActiveChain(DEFAULT_SETTINGS.activeChain);
    setShowDisclaimer(DEFAULT_SETTINGS.showDisclaimer);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_SETTINGS));
  }, []);

  const value = useMemo(
    () => ({
      profileName,
      tradeAmount,
      tpROI,
      stopLoss,
      activeChain,
      showDisclaimer,
      hydrated,
      setProfileName: setProfileNameSafe,
      setTradeAmount: setTradeAmountSafe,
      setTpROI: setTpROISafe,
      setStopLoss: setStopLossSafe,
      setActiveChain: setActiveChainSafe,
      setShowDisclaimer: setShowDisclaimerSafe,
      resetSettings,
    }),
    [
      activeChain, hydrated, profileName, resetSettings,
      setActiveChainSafe, setProfileNameSafe, setShowDisclaimerSafe, setStopLossSafe,
      setTpROISafe, setTradeAmountSafe, showDisclaimer, stopLoss, tpROI, tradeAmount,
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
