import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import type { ChainType } from '@/contexts/trade-settings-context';

type ChainSwitcherProps = {
  value: ChainType;
  onChange: (chain: ChainType) => void;
};

const ChainButton = memo(function ChainButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.chainButton}>
      <LinearGradient
        colors={active ? ['rgba(86,136,255,0.65)', 'rgba(36,217,177,0.4)'] : ['rgba(255,255,255,0.09)', 'rgba(255,255,255,0.03)']}
        style={styles.chainInner}
      >
        <Text style={[styles.chainText, active && styles.chainTextActive]}>{label}</Text>
      </LinearGradient>
    </Pressable>
  );
});

export const ChainSwitcher = memo(function ChainSwitcher({ value, onChange }: ChainSwitcherProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Chain</Text>
      <View style={styles.row}>
        <ChainButton label="Solana" active={value === 'solana'} onPress={() => onChange('solana')} />
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
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  chainButton: {
    flex: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  chainInner: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingVertical: 10,
    alignItems: 'center',
  },
  chainText: {
    color: '#ced7f2',
    fontWeight: '700',
    fontSize: 14,
  },
  chainTextActive: {
    color: '#f2f7ff',
  },
});
