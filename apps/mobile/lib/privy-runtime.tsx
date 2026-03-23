import React from 'react';
import { Platform } from 'react-native';

type PrivyModuleType = typeof import('@privy-io/expo');

let privyModule: PrivyModuleType | null = null;
const isWeb = Platform.OS === 'web';

if (!isWeb) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    privyModule = require('@privy-io/expo');
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Privy SDK could not be loaded (web fallback).', error);
    }
  }
}

type PrivyUseResult = ReturnType<PrivyModuleType['usePrivy']>;

const emptyPrivyValue: PrivyUseResult = {
  user: null,
  logout: async () => {},
  isReady: true,
  login: async () => {},
  // Fill the rest with noop values just in case the app expects them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as PrivyUseResult;

const getPrivyModule = (): PrivyModuleType | null => privyModule;

export function usePrivy(): PrivyUseResult {
  const mod = getPrivyModule();
  if (mod) {
    return mod.usePrivy();
  }
  return emptyPrivyValue;
}

export function useEmbeddedSolanaWallet(): ReturnType<PrivyModuleType['useEmbeddedSolanaWallet']> {
  const mod = getPrivyModule();
  if (mod) {
    return mod.useEmbeddedSolanaWallet();
  }
  return null;
}

type PrivyProviderProps = React.ComponentProps<
  NonNullable<PrivyModuleType['PrivyProvider']>
>;

export function PrivyProviderWrapper(props: PrivyProviderProps) {
  const mod = getPrivyModule();
  if (!mod || !mod.PrivyProvider) {
    return <>{props.children}</>;
  }
  const Provider = mod.PrivyProvider;
  return <Provider {...props} />;
}
