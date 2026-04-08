import React, { memo, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { useTradeSettings } from '@/contexts/trade-settings-context';

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

type SettingRowProps = {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  onFocusChange?: (focused: boolean) => void;
};

const SettingRow = memo(function SettingRow({
  label,
  suffix,
  value,
  min,
  max,
  step,
  onChange,
  onFocusChange,
}: SettingRowProps) {
  const inputRef = useRef<TextInput>(null);
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <Pressable
      style={styles.rowWrap}
      onPress={() => inputRef.current?.focus()}
      hitSlop={6}
    >
      <View style={styles.rowTop}>
        <Text style={styles.rowLabel}>{label}</Text>
        <View style={styles.valueInputWrap}>
          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            onFocus={() => onFocusChange?.(true)}
            onBlur={() => {
              onFocusChange?.(false);
              const parsed = clamp(Number(text), min, max);
              onChange(parsed);
              setText(String(parsed));
            }}
            keyboardType="decimal-pad"
            style={styles.valueInput}
          />
          <Text style={styles.suffix}>{suffix}</Text>
        </View>
      </View>
    </Pressable>
  );
});

type TradeSettingsProps = {
  onInputFocusChange?: (focused: boolean) => void;
};

export const TradeSettings = memo(function TradeSettings({ onInputFocusChange }: TradeSettingsProps) {
  const { tradeAmount, tpROI, stopLoss, setTradeAmount, setTpROI, setStopLoss } = useTradeSettings();

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Trading Settings</Text>
      <SettingRow
        label="Trade Amount"
        suffix="$"
        value={tradeAmount}
        min={0.0001}
        max={500}
        step={0.0001}
        onChange={setTradeAmount}
        onFocusChange={onInputFocusChange}
      />
      <SettingRow
        label="Take Profit ROI"
        suffix="%"
        value={tpROI}
        min={0.1}
        max={200}
        step={0.1}
        onChange={setTpROI}
        onFocusChange={onInputFocusChange}
      />
      <SettingRow
        label="Stop Loss"
        suffix="%"
        value={stopLoss}
        min={0.1}
        max={50}
        step={0.1}
        onChange={setStopLoss}
        onFocusChange={onInputFocusChange}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginTop: 18,
    gap: 12,
  },
  title: {
    color: '#a7b4d5',
    fontSize: 13,
    fontWeight: '700',
  },
  rowWrap: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 12,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLabel: {
    color: '#edf2ff',
    fontSize: 14,
    fontWeight: '700',
  },
  valueInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  valueInput: {
    color: '#e9f1ff',
    minWidth: 62,
    textAlign: 'right',
    fontWeight: '700',
    fontSize: 14,
  },
  suffix: {
    color: '#9eb0d5',
    fontWeight: '700',
  },
});
