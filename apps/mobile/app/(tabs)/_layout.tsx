import { Tabs } from 'expo-router';
import React from 'react';
import 'react-native-get-random-values';

import { LiquidTabBar } from '@/components/liquid-tab-bar';

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <LiquidTabBar {...props} />}
      screenOptions={{
        headerShown: false,
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="trades" options={{ title: 'Trades' }} />
      <Tabs.Screen name="wallet" options={{ title: 'Wallet' }} />
    </Tabs>
  );
}
