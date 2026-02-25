import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';

type TradeStatus = 'open' | 'closed';
type TradeItem = {
  id: string;
  symbol: string;
  status: TradeStatus;
  pnl: number;
};

const MOCK_TRADES: TradeItem[] = Array.from({ length: 120 }, (_, i) => ({
  id: `trade-${i + 1}`,
  symbol: `TK${(i % 40) + 1}`,
  status: i % 3 === 0 ? 'open' : 'closed',
  pnl: (Math.random() - 0.45) * 1000,
}));

type Filter = 'all' | 'open' | 'closed' | 'profit' | 'loss';

export default function TradesScreen() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const filtered = useMemo(() => {
    return MOCK_TRADES.filter((trade) => {
      if (query && !trade.symbol.toLowerCase().includes(query.toLowerCase())) return false;
      if (filter === 'open' && trade.status !== 'open') return false;
      if (filter === 'closed' && trade.status !== 'closed') return false;
      if (filter === 'profit' && trade.pnl <= 0) return false;
      if (filter === 'loss' && trade.pnl >= 0) return false;
      return true;
    });
  }, [filter, query]);

  const paged = filtered.slice(0, page * pageSize);
  const hasMore = paged.length < filtered.length;

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>Trades</Text>
      <TextInput
        value={query}
        onChangeText={(text) => {
          setQuery(text);
          setPage(1);
        }}
        placeholder="Search by token"
        placeholderTextColor="#7f8cae"
        style={styles.search}
      />

      <View style={styles.filterRow}>
        {(['all', 'open', 'closed', 'profit', 'loss'] as Filter[]).map((item) => (
          <Pressable key={item} onPress={() => setFilter(item)} style={[styles.filterChip, filter === item && styles.filterChipActive]}>
            <Text style={[styles.filterText, filter === item && styles.filterTextActive]}>{item.toUpperCase()}</Text>
          </Pressable>
        ))}
      </View>

      <FlatList
        data={paged}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.symbol}>{item.symbol}</Text>
            <Text style={styles.status}>{item.status}</Text>
            <Text style={[styles.pnl, item.pnl >= 0 ? styles.green : styles.red]}>
              {item.pnl >= 0 ? '+' : ''}
              {item.pnl.toFixed(2)} USDT
            </Text>
          </View>
        )}
        contentContainerStyle={styles.listContent}
        onEndReached={() => {
          if (hasMore) setPage((p) => p + 1);
        }}
        onEndReachedThreshold={0.2}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#05070f', padding: 16 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 12 },
  search: {
    height: 42,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    color: '#fff',
    paddingHorizontal: 12,
  },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 10 },
  filterChip: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  filterChipActive: { backgroundColor: 'rgba(111,173,255,0.22)', borderColor: 'rgba(111,173,255,0.6)' },
  filterText: { color: '#b8c6e8', fontSize: 11, fontWeight: '700' },
  filterTextActive: { color: '#fff' },
  listContent: { paddingBottom: 40, gap: 10 },
  card: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 14,
    padding: 12,
  },
  symbol: { color: '#fff', fontWeight: '800', fontSize: 16 },
  status: { color: '#9db0db', marginTop: 4 },
  pnl: { marginTop: 6, fontWeight: '700' },
  green: { color: '#4ade80' },
  red: { color: '#ff6b81' },
});

