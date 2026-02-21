import "@ethersproject/shims";
import "fast-text-encoding";
import "react-native-get-random-values";

import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import Constants from "expo-constants";
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { Text, View } from "react-native";
import { PrivyProvider } from "@privy-io/expo";

import { useColorScheme } from '@/hooks/use-color-scheme';
import { WalletProvider } from '@/contexts/wallet-context';

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

  return (
    <PrivyProvider
      appId={privyAppId}
      clientId={privyClientId}
      config={{
        embedded: {
          // Solana embedded wallet support for deposit addresses.
          solana: {
            createOnLogin: "off",
          },
        },
      }}
    >
      <WalletProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="auto" />
        </ThemeProvider>
      </WalletProvider>
    </PrivyProvider>
  );
}
