import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
import "@ethersproject/shims";
import "fast-text-encoding";

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import Constants from "expo-constants";
import { Stack, usePathname, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { Text, View, Platform } from "react-native";
import { PrivyProviderWrapper } from "@/lib/privy-runtime";
import { OnboardingScreen } from '@/components/onboarding-screen';
import { PrivyProvider } from '@privy-io/react-auth';
import React from 'react';

import { AuthProvider, useAuth } from '@/contexts/auth-context';
import { TradeSettingsProvider } from '@/contexts/trade-settings-context';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { WalletProvider } from '@/contexts/wallet-context';
import { useWalletContext } from '@/contexts/wallet-context';
import { initializeNotifications } from '@/lib/notifications';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const processPolyfill = require('process');

if (!(globalThis as any).Buffer) {
  (globalThis as any).Buffer = Buffer;
}
if (!(globalThis as any).process) {
  (globalThis as any).process = processPolyfill;
}

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const extra = (Constants.expoConfig?.extra || {}) as {
    privyAppId?: string;
    privyClientId?: string;
  };
  const privyAppId = process.env.EXPO_PUBLIC_PRIVY_APP_ID || extra.privyAppId || "";
  const privyClientId = process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID || extra.privyClientId;
  const isWeb = Platform.OS === 'web';

  React.useEffect(() => {
    void initializeNotifications();
  }, []);

  React.useEffect(() => {
    if (isWeb) {
      console.log('PrivyProvider mounted');
    }
  }, [isWeb]);

  console.log('Privy App ID:', privyAppId);
  console.log('Privy Client ID:', privyClientId);
  console.log('Privy OAuth Redirect URL:', Linking.createURL('/privy/oauth'));

  if (!privyAppId) {
    return (
      <View style={{ flex: 1, backgroundColor: "#000", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: "#fff", fontSize: 24, fontWeight: "700" }}>Privy Not Configured</Text>
        <Text style={{ color: "#bbb", marginTop: 12 }}>
          Set EXPO_PUBLIC_PRIVY_APP_ID or app.json {'->'} expo.extra.privyAppId, then restart Expo.
        </Text>
      </View>
    );
  }

  const mainContent = (
    <AuthProvider>
      <WalletProvider>
        <TradeSettingsProvider>
          <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
            <AuthGatedApp />
            <StatusBar style="auto" />
          </ThemeProvider>
        </TradeSettingsProvider>
      </WalletProvider>
    </AuthProvider>
  );

  const mobileContent = (
    <PrivyProviderWrapper
      appId={privyAppId}
      clientId={privyClientId}
      config={{
        appearance: {
          theme: 'dark',
        },
        loginMethods: ['twitter', 'email'],
        // Privy Expo SDK expects a path, not a full scheme URI.
        // Expo will build the full deep link with the correct scheme.
        redirectUri: "/privy/oauth",
        embeddedWallets: {
          createOnLogin: 'users-without-wallets',
        },
        embedded: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
          solana: {
            createOnLogin: "users-without-wallets",
          },
        },
      } as any}
    >
      {mainContent}
    </PrivyProviderWrapper>
  );

  const webContent = (
    <PrivyProvider
      appId={privyAppId}
      clientId={privyClientId || undefined}
      config={{
        loginMethods: ['twitter'],
        appearance: {
          theme: 'dark',
        },
      }}
    >
      {mainContent}
    </PrivyProvider>
  );

  return isWeb ? webContent : mobileContent;
}

function AuthGatedApp() {
  const { loading, requiresDeposit, balanceLoading, isLoggedIn } = useAuth();
  const { twitterProfile } = useWalletContext();
  const { user: privyUser } = usePrivy();
  const { tradingWalletAddress, walletAddress } = useWalletContext();
  const router = useRouter();
  const pathname = usePathname();

  React.useEffect(() => {
    if (loading || balanceLoading) return;
    if (requiresDeposit && pathname !== '/deposit') {
      router.replace('/deposit');
      return;
    }
  }, [balanceLoading, loading, pathname, requiresDeposit, router]);

  const linkedAccounts = Array.isArray((privyUser as any)?.linked_accounts)
    ? (privyUser as any).linked_accounts
    : Array.isArray((privyUser as any)?.linkedAccounts)
      ? (privyUser as any).linkedAccounts
      : [];
  const hasEmail = linkedAccounts.some((account: any) => account?.type === "email");
  const hasWallet = Boolean(tradingWalletAddress || walletAddress);

  // Require Twitter + Email + Wallet before proceeding
  if (!loading && (!isLoggedIn || !twitterProfile || !hasEmail || !hasWallet)) {
    return <OnboardingScreen />;
  }

  return (
    <>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="deposit" options={{ title: 'Fund Wallet' }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
    </>
  );
}
