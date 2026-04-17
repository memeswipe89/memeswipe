import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';

export function TradingDisclaimer() {
  return (
    <View style={styles.container}>
      <MaterialIcons name="info-outline" size={11} color="rgba(255,255,255,0.4)" />
      <Text style={styles.text}>Not financial advice. Trade at your own risk.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 6,
  },
  text: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '500',
  },
});
