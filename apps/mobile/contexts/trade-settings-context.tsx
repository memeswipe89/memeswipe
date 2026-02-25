import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

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

const DEFAULT_SETTINGS = {
  profileName: 'Trader',
  tradeAmount: 10,
  tpROI: 50,
  stopLoss: 15,
  activeChain: 'solana' as ChainType,
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

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;

    const persist = async () => {
      try {
        await AsyncStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ profileName, tradeAmount, tpROI, stopLoss, activeChain })
        );
      } catch (err) {
        console.log('Failed to save settings', err);
      }
    };

    const timer = setTimeout(() => {
      persist();
    }, 180);

    return () => clearTimeout(timer);
  }, [activeChain, hydrated, profileName, stopLoss, tpROI, tradeAmount]);

  const setTradeAmountSafe = useCallback((value: number) => {
    setTradeAmount(Number.isFinite(value) ? Math.max(1, value) : DEFAULT_SETTINGS.tradeAmount);
  }, []);

  const setTpROISafe = useCallback((value: number) => {
    setTpROI(Number.isFinite(value) ? Math.max(1, value) : DEFAULT_SETTINGS.tpROI);
  }, []);

  const setStopLossSafe = useCallback((value: number) => {
    setStopLoss(Number.isFinite(value) ? Math.max(1, value) : DEFAULT_SETTINGS.stopLoss);
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
  const ctx = useContext(TradeSettingsContext);
  if (!ctx) {
    throw new Error('useTradeSettings must be used inside TradeSettingsProvider');
  }
  return ctx;
}
