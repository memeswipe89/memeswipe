import 'react-native-get-random-values';
import 'react-native-url-polyfill/auto';
import { Buffer } from 'buffer';
import "@ethersproject/shims";
import "fast-text-encoding";

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import Constants from "expo-constants";
import { Stack, usePathname, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { Text, View } from "react-native";
import { PrivyProviderWrapper, usePrivy } from "@/lib/privy-runtime";
import { OnboardingScreen } from '@/components/onboarding-screen';
import { LoadingScreen } from '@/components/loading-screen';
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

  React.useEffect(() => {
    void initializeNotifications();
  }, []);

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

  const content = (
    <PrivyProviderWrapper
      appId={privyAppId}
      clientId={privyClientId}
      config={{
        appearance: {
          theme: 'dark',
        },
        loginMethods: ['twitter', 'apple', 'email'],
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
    </PrivyProviderWrapper>
  );

  return content;
}

function AuthGatedApp() {
  const { loading, requiresDeposit, balanceLoading, isLoggedIn } = useAuth();
  const { user: privyUser } = usePrivy();
  const { tradingWalletAddress, walletAddress } = useWalletContext();
  const router = useRouter();
  const pathname = usePathname();
  const [isInitializing, setIsInitializing] = React.useState(true);

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
  const hasTwitter = linkedAccounts.some((account: any) => account?.type === "twitter_oauth");
  const hasApple = linkedAccounts.some((account: any) => account?.type === "apple_oauth" || account?.type === "apple");
  const hasSocialLogin = hasTwitter || hasApple;
  const hasWallet = Boolean(tradingWalletAddress || walletAddress);

  // Determine what needs to be shown
  const showOnboarding = !isLoggedIn || !hasSocialLogin || !hasEmail || !hasWallet;

  // Show loading screen while initializing or checking
  React.useEffect(() => {
    if (!loading && !balanceLoading) {
      // Small delay to ensure smooth transition
      const timer = setTimeout(() => {
        setIsInitializing(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [loading, balanceLoading]);

  // Show loading screen during initialization
  if (isInitializing || loading || balanceLoading) {
    return <LoadingScreen />;
  }

  // Show onboarding if needed (includes age verification and risk warning)
  if (showOnboarding) {
    return <OnboardingScreen />;
  }

  // All checks passed, show main app
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="terms" options={{ headerShown: false }} />
      <Stack.Screen name="deposit" options={{ title: 'Fund Wallet' }} />
      <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
    </Stack>
  );
}
