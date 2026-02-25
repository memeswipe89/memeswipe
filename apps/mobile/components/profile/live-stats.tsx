import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export const LiveStats = memo(function LiveStats() {
  const stats = [
    { label: 'Total Profit', value: '+$0.00' },
    { label: 'Active Trades', value: '0' },
    { label: 'Trades Executed', value: '0' },
  ];

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Live Stats</Text>
      <View style={styles.grid}>
        {stats.map((item) => (
          <View key={item.label} style={styles.card}>
            <Text style={styles.label}>{item.label}</Text>
            <Text style={styles.value}>{item.value}</Text>
          </View>
        ))}
      </View>
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
  grid: {
    flexDirection: 'row',
    gap: 8,
  },
  card: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
    padding: 10,
  },
  label: {
    color: '#98a6c9',
    fontSize: 11,
    fontWeight: '600',
  },
  value: {
    color: '#ecf2ff',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 6,
  },
});
