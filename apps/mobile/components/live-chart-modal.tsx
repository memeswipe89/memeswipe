import React from 'react';
import {
  Modal,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';

type Props = {
  visible: boolean;
  onClose: () => void;
  address: string;
  pairAddress?: string;
  symbol: string;
  chain?: string;
  source?: string;
};

export default function LiveChartModal({
  visible,
  onClose,
  address,
  pairAddress,
  symbol,
  chain,
  source,
}: Props) {
  // Build the DexScreener embed URL
  // Use pairAddress if available (most reliable), else token address
  const isBase = source === 'bags' || chain === 'base';
  const chainSlug = isBase ? 'base' : 'solana';
  const id = pairAddress || address;

  // DexScreener embed — dark theme, hide info bar for cleaner look
  const embedUrl =
    `https://dexscreener.com/${chainSlug}/${id}` +
    `?embed=1&theme=dark&trades=0&info=0`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.symbol}>{symbol}</Text>
            <Text style={styles.chainBadge}>{isBase ? 'BASE' : 'SOL'}</Text>
          </View>
          <Pressable onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        </View>

        {/* Live chart */}
        <WebView
          source={{ uri: embedUrl }}
          style={styles.webview}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
          renderLoading={() => (
            <View style={styles.loading}>
              <Text style={styles.loadingText}>Loading chart…</Text>
            </View>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d18',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  symbol: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  chainBadge: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 11,
    fontWeight: '700',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0d0d18',
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0d0d18',
  },
  loadingText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
});
