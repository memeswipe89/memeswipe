import React, { memo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

type ProfileButtonProps = {
  onPress: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
};

export const ProfileButton = memo(function ProfileButton({ onPress, onLongPress, disabled }: ProfileButtonProps) {
  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
    onPress();
  };

  const handleLongPress = () => {
    if (onLongPress) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
      onLongPress();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      disabled={disabled}
      android_ripple={{ color: 'rgba(255,255,255,0.08)' }}
      style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
    >
      <Ionicons name="person-circle-outline" size={24} color="#f7f7f7" />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pressable: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#171717',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pressed: {
    opacity: 0.88,
  },
});
