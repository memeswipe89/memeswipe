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
import { Text, View, Alert } from "react-native";
import { PrivyProviderWrapper, usePrivy } from "@/lib/privy-runtime";
import { OnboardingScreen } from '@/components/onboarding-screen';
import { RiskWarningModal } from '@/components/risk-warning-modal';
import { LoadingScreen } from '@/components/loading-screen';
import { AgeVerificationScreen } from '@/components/age-verification-screen';
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

const RISK_WARNING_ACCEPTED_KEY = '@memeswipe:riskWarningAccepted:v1';
const AGE_VERIFIED_KEY = '@memeswipe:ageVerified:v1';

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
  const { twitterProfile } = useWalletContext();
  const { user: privyUser } = usePrivy();
  const { tradingWalletAddress, walletAddress } = useWalletContext();
  const router = useRouter();
  const pathname = usePathname();
  const [ageVerified, setAgeVerified] = React.useState(false);
  const [ageVerificationChecked, setAgeVerificationChecked] = React.useState(false);
  const [showRiskWarning, setShowRiskWarning] = React.useState(false);
  const [riskWarningChecked, setRiskWarningChecked] = React.useState(false);
  const [isInitializing, setIsInitializing] = React.useState(true);

  // Check if user has verified age
  React.useEffect(() => {
    const checkAgeVerification = async () => {
      try {
        const verified = await AsyncStorage.getItem(AGE_VERIFIED_KEY);
        if (verified === 'true') {
          setAgeVerified(true);
        }
      } catch (error) {
        // Error checking age verification
      } finally {
        setAgeVerificationChecked(true);
      }
    };
    
    void checkAgeVerification();
  }, []);

  // Check if user has accepted risk warning
  React.useEffect(() => {
    const checkRiskWarning = async () => {
      try {
        const accepted = await AsyncStorage.getItem(RISK_WARNING_ACCEPTED_KEY);
        if (accepted === 'true') {
          setRiskWarningChecked(true);
        } else {
          setShowRiskWarning(true);
        }
      } catch (error) {
        // Error checking risk warning
        setShowRiskWarning(true);
      }
    };
    
    if (isLoggedIn && !loading && ageVerified) {
      void checkRiskWarning();
    }
  }, [isLoggedIn, loading, ageVerified]);

  const handleAcceptRiskWarning = async () => {
    try {
      await AsyncStorage.setItem(RISK_WARNING_ACCEPTED_KEY, 'true');
      setShowRiskWarning(false);
      setRiskWarningChecked(true);
    } catch (error) {
      // Error saving risk warning acceptance
    }
  };

  const handleDeclineRiskWarning = () => {
    Alert.alert(
      'Terms Required',
      'You must accept the risk disclosure to use this app.',
      [{ text: 'OK' }]
    );
  };

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
  const needsAgeVerification = !showOnboarding && !ageVerified;
  const needsRiskWarning = isLoggedIn && !showOnboarding && ageVerified && !riskWarningChecked;
  const allChecksComplete = !showOnboarding && !needsAgeVerification && !needsRiskWarning;

  // Show loading screen while initializing or checking
  React.useEffect(() => {
    if (!loading && !balanceLoading && ageVerificationChecked) {
      // Small delay to ensure smooth transition
      const timer = setTimeout(() => {
        setIsInitializing(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [loading, balanceLoading, ageVerificationChecked]);

  // Show loading screen during initialization
  if (isInitializing || loading || balanceLoading || !ageVerificationChecked) {
    return <LoadingScreen />;
  }

  // Show onboarding if needed
  if (showOnboarding) {
    return <OnboardingScreen />;
  }

  // Show age verification if needed
  if (needsAgeVerification) {
    return <AgeVerificationScreen onVerified={() => setAgeVerified(true)} />;
  }

  // Show risk warning if needed
  if (needsRiskWarning && showRiskWarning) {
    return (
      <RiskWarningModal
        visible={true}
        onAccept={handleAcceptRiskWarning}
        onDecline={handleDeclineRiskWarning}
      />
    );
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
