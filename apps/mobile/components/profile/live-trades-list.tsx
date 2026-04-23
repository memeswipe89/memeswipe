import React, { memo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

type TradeItem = {
  id: string;
  symbol: string;
  entryPrice: string;
  roi: string;
  status: 'open' | 'closed';
  imageUrl?: string;
};

const MOCK_TRADES: TradeItem[] = [
  { 
    id: '1', 
    symbol: 'PEPE', 
    entryPrice: '$0.000011', 
    roi: '+8.2%', 
    status: 'open',
    imageUrl: 'https://dd.dexscreener.com/ds-data/tokens/ethereum/0x6982508145454ce325ddbe47a25d4ec3d2311933.png'
  },
  { 
    id: '2', 
    symbol: 'BONK', 
    entryPrice: '$0.000024', 
    roi: '-2.6%', 
    status: 'open',
    imageUrl: 'https://dd.dexscreener.com/ds-data/tokens/solana/DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263.png'
  },
  { 
    id: '3', 
    symbol: 'WIF', 
    entryPrice: '$2.11', 
    roi: '+16.9%', 
    status: 'closed',
    imageUrl: 'https://dd.dexscreener.com/ds-data/tokens/solana/EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm.png'
  },
  { 
    id: '4', 
    symbol: 'FLOKI', 
    entryPrice: '$0.00017', 
    roi: '+4.1%', 
    status: 'closed',
    imageUrl: 'https://dd.dexscreener.com/ds-data/tokens/ethereum/0xcf0c122c6b73ff809c693db761e7baebe62b6a2e.png'
  },
];

export const LiveTradesList = memo(function LiveTradesList() {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Live Trades</Text>
      <ScrollView style={styles.list} showsVerticalScrollIndicator={false} nestedScrollEnabled>
        {MOCK_TRADES.map((trade) => (
          <View key={trade.id} style={styles.row}>
            <View style={styles.leftCol}>
              {trade.imageUrl ? (
                <Image
                  source={{ uri: trade.imageUrl }}
                  style={styles.tokenImage}
                  contentFit="cover"
                  transition={200}
                />
              ) : (
                <View style={styles.tokenImagePlaceholder}>
                  <Text style={styles.placeholderText}>{trade.symbol[0]}</Text>
                </View>
              )}
              <View style={styles.tokenInfo}>
                <Text style={styles.symbol}>{trade.symbol}</Text>
                <Text style={styles.sub}>Entry {trade.entryPrice}</Text>
              </View>
            </View>
            <View style={styles.rightCol}>
              <Text style={[styles.roi, trade.roi.startsWith('+') ? styles.green : styles.red]}>{trade.roi}</Text>
              <Text style={[styles.status, trade.status === 'open' ? styles.open : styles.closed]}>{trade.status.toUpperCase()}</Text>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginTop: 16,
  },
  title: {
    color: '#a7b4d5',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
  list: {
    maxHeight: 190,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  leftCol: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  tokenImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  tokenImagePlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginRight: 12,
    backgroundColor: 'rgba(82,130,255,0.2)',
    borderWidth: 2,
    borderColor: 'rgba(82,130,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholderText: {
    color: '#5282ff',
    fontSize: 16,
    fontWeight: '800',
  },
  tokenInfo: {
    flex: 1,
  },
  symbol: {
    color: '#f0f5ff',
    fontSize: 15,
    fontWeight: '800',
  },
  sub: {
    color: '#9ca9ca',
    marginTop: 4,
    fontSize: 12,
  },
  rightCol: {
    alignItems: 'flex-end',
  },
  roi: {
    fontSize: 14,
    fontWeight: '800',
  },
  green: {
    color: '#4de99a',
  },
  red: {
    color: '#ff7c94',
  },
  status: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 4,
    letterSpacing: 0.7,
  },
  open: {
    color: '#80f0b4',
  },
  closed: {
    color: '#aeb8d0',
  },
});
