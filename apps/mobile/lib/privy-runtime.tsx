import React from 'react';
import type {
  LinkWithEmailHookResult,
  LinkWithEmailOptions,
  OAuthFlowState,
  OtpFlowState,
} from '@privy-io/expo';

type PrivyModuleType = typeof import('@privy-io/expo');

let privyModule: PrivyModuleType | null = null;

type PrivyUseResult = ReturnType<PrivyModuleType['usePrivy']>;

const emptyPrivyValue: PrivyUseResult = {
  user: null,
  logout: async () => {},
  isReady: true,
  login: async () => {},
  // Fill the rest with noop values just in case the app expects them.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as PrivyUseResult;

const initialOAuthState: OAuthFlowState = { status: 'initial' };
const initialOtpState: OtpFlowState = { status: 'initial' };
const emptyLoginWithOAuth: ReturnType<PrivyModuleType['useLoginWithOAuth']> = {
  state: initialOAuthState,
  login: async () => undefined,
};
const emptyLinkWithOAuth: ReturnType<PrivyModuleType['useLinkWithOAuth']> = {
  state: initialOAuthState,
  link: async () => undefined,
};
const emptyLinkEmail: LinkWithEmailHookResult = {
  state: initialOtpState,
  sendCode: async () => ({ success: true }),
  linkWithCode: async () => undefined,
};

const getPrivyModule = (): PrivyModuleType | null => {
  if (privyModule) return privyModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    privyModule = require('@privy-io/expo');
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn('Privy SDK could not be loaded.', error);
    }
    privyModule = null;
  }
  return privyModule;
};

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

export function useLoginWithOAuth(
  opts?: Parameters<PrivyModuleType['useLoginWithOAuth']>[0]
): ReturnType<PrivyModuleType['useLoginWithOAuth']> {
  const mod = getPrivyModule();
  if (mod) {
    return mod.useLoginWithOAuth(opts);
  }
  return emptyLoginWithOAuth;
}

export function useLinkWithOAuth(
  opts?: Parameters<PrivyModuleType['useLinkWithOAuth']>[0]
): ReturnType<PrivyModuleType['useLinkWithOAuth']> {
  const mod = getPrivyModule();
  if (mod) {
    return mod.useLinkWithOAuth(opts);
  }
  return emptyLinkWithOAuth;
}

export function useLinkEmail(
  opts?: LinkWithEmailOptions
): LinkWithEmailHookResult {
  const mod = getPrivyModule();
  if (mod) {
    return mod.useLinkEmail(opts);
  }
  return emptyLinkEmail;
}

type PrivyProviderProps = React.ComponentProps<
  NonNullable<PrivyModuleType['PrivyProvider']>
>;

export function PrivyProviderWrapper(props: PrivyProviderProps) {
  const mod = getPrivyModule();
  if (!mod || !mod.PrivyProvider) {
    console.log('[Privy] Provider wrapper - PrivyProvider unavailable', {
      privyModuleLoaded: Boolean(mod),
      provider: Boolean(mod?.PrivyProvider),
    });
    return <>{props.children}</>;
  }
  const Provider = mod.PrivyProvider;
  console.log('[Privy] Provider wrapper - mounting PrivyProvider');
  return <Provider {...props} />;
}
