'use client';

import { Platform } from 'react-native';
import type {
  OAuthFlowState,
  OtpFlowState,
} from '@privy-io/expo';
import {
  usePrivy as usePrivyMobile,
  useLoginWithOAuth as useLoginWithOAuthMobile,
  useLinkWithOAuth as useLinkWithOAuthMobile,
  useLinkEmail as useLinkEmailMobile,
  useEmbeddedSolanaWallet as useEmbeddedSolanaWalletMobile,
} from '@/lib/privy-runtime';
import {
  useLinkEmail as useLinkEmailWeb,
  useLinkWithOAuth as useLinkWithOAuthWeb,
  useLoginWithOAuth as useLoginWithOAuthWeb,
  usePrivy as usePrivyWeb,
} from '@privy-io/react-auth';

const isWeb = Platform.OS === 'web';

export function usePrivy() {
  return isWeb ? usePrivyWeb() : usePrivyMobile();
}

export function useLoginWithOAuth(
  opts?: Parameters<typeof useLoginWithOAuthWeb>[0]
) {
  return isWeb ? useLoginWithOAuthWeb(opts) : useLoginWithOAuthMobile(opts as any);
}

export function useLinkWithOAuth(
  opts?: Parameters<typeof useLinkWithOAuthWeb>[0]
) {
  return isWeb ? useLinkWithOAuthWeb(opts) : useLinkWithOAuthMobile(opts as any);
}

export function useLinkEmail(
  opts?: Parameters<typeof useLinkEmailWeb>[0]
) {
  return isWeb ? useLinkEmailWeb(opts) : useLinkEmailMobile(opts as any);
}

export function useEmbeddedSolanaWallet() {
  return useEmbeddedSolanaWalletMobile();
}
