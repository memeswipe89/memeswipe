import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

type SafeSliderProps = {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
};

export const SafeSlider = memo(function SafeSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '',
}: SafeSliderProps) {
  const handleValueChange = (newValue: number) => {
    // Trigger haptic feedback on value change
    Haptics.selectionAsync().catch(() => undefined);
    onChange(newValue);
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>
        {label}: {value}
        {suffix}
      </Text>

      <Slider
        value={value}
        minimumValue={min}
        maximumValue={max}
        step={step}
        minimumTrackTintColor="#79a5ff"
        maximumTrackTintColor="#2a3244"
        thumbTintColor="#9bc2ff"
        onValueChange={handleValueChange}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    marginTop: 12,
  },
  label: {
    color: '#dce7ff',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 8,
  },
});
