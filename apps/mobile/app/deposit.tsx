import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/auth-context';
import { useWalletContext } from '@/contexts/wallet-context';

export default function DepositScreen() {
  const router = useRouter();
  const { balance, refreshBalanceCheck } = useAuth();
  const {
    walletAddress,
    tradingWalletAddress,
    walletLoading,
    walletError,
    refreshWalletAddress,
    getOrCreateTradingWalletAddress,
  } = useWalletContext();
  const targetWalletAddress = tradingWalletAddress || walletAddress;

  React.useEffect(() => {
    if (targetWalletAddress) return;
    void (async () => {
      try {
        const refreshed = await refreshWalletAddress();
        if (refreshed) return;
        await getOrCreateTradingWalletAddress();
      } catch {
        // surface via walletError
      }
    })();
  }, [getOrCreateTradingWalletAddress, refreshWalletAddress, targetWalletAddress]);

  const copyAddress = async () => {
    if (!targetWalletAddress) return;
    await Clipboard.setStringAsync(targetWalletAddress);
    Alert.alert('Copied', 'Wallet address copied to clipboard.');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Minimum balance required to trade</Text>
      <Text style={styles.subtitle}>Please fund your wallet to at least $1.5 equivalent before continuing.</Text>

      <View style={styles.panel}>
        <Text style={styles.label}>Your wallet</Text>
        <Text selectable style={styles.address}>
          {targetWalletAddress || (walletLoading ? 'Loading wallet...' : 'No wallet found yet')}
        </Text>
        <Text style={styles.network}>Network: Solana (mainnet)</Text>
        {walletError ? <Text style={styles.error}>Wallet issue: {walletError}</Text> : null}
        {typeof balance === 'number' ? <Text style={styles.balance}>Current balance: {balance.toFixed(6)} SOL</Text> : null}
      </View>

      {targetWalletAddress ? (
        <View style={styles.qrWrap}>
          <View style={styles.qrCard}>
            <QRCode value={targetWalletAddress} size={210} />
          </View>
        </View>
      ) : null}

      <Pressable style={styles.primary} onPress={copyAddress} disabled={!targetWalletAddress}>
        <Text style={styles.primaryText}>Copy Address</Text>
      </Pressable>

      {!targetWalletAddress ? (
        <Pressable
          style={styles.secondary}
          onPress={() => void getOrCreateTradingWalletAddress()}
          disabled={walletLoading}
        >
          <Text style={styles.secondaryText}>{walletLoading ? 'Creating Wallet...' : 'Create Trading Wallet'}</Text>
        </Pressable>
      ) : null}

      <Pressable
        style={styles.secondary}
        onPress={async () => {
          await refreshBalanceCheck();
          router.replace('/(tabs)');
        }}
      >
        <Text style={styles.secondaryText}>I have funded, continue</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0C10',
  },
  content: {
    padding: 20,
    paddingTop: 60,
  },
  title: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9CA3AF',
    marginTop: 10,
    lineHeight: 20,
  },
  panel: {
    marginTop: 18,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#151922',
    padding: 14,
  },
  label: {
    color: '#9CA3AF',
    fontSize: 13,
  },
  address: {
    color: '#fff',
    marginTop: 8,
    fontFamily: 'Courier',
    fontSize: 13,
  },
  network: {
    color: '#9CA3AF',
    marginTop: 8,
  },
  balance: {
    color: '#fff',
    marginTop: 6,
    fontWeight: '700',
  },
  error: {
    color: '#ef4444',
    marginTop: 8,
    fontSize: 12,
  },
  qrWrap: {
    alignItems: 'center',
    marginTop: 18,
  },
  qrCard: {
    backgroundColor: '#fff',
    padding: 10,
    borderRadius: 12,
  },
  primary: {
    marginTop: 18,
    backgroundColor: '#1DA1F2',
    borderRadius: 12,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  secondary: {
    marginTop: 10,
    borderRadius: 12,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1C1F26',
  },
  secondaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
