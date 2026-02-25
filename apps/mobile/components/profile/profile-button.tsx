import React, { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';

type ProfileButtonProps = {
  onPress: () => void;
  onLongPress?: () => void;
  initials: string;
  disabled?: boolean;
};

export const ProfileButton = memo(function ProfileButton({ onPress, onLongPress, initials, disabled }: ProfileButtonProps) {
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} disabled={disabled} style={styles.pressable}>
      <LinearGradient colors={['rgba(130,163,255,0.45)', 'rgba(24,245,186,0.18)']} style={styles.ring}>
        <BlurView intensity={28} tint="dark" style={styles.avatar}>
          <Text style={styles.initials}>{initials}</Text>
        </BlurView>
      </LinearGradient>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  pressable: {
    width: 46,
    height: 46,
    borderRadius: 23,
    overflow: 'hidden',
  },
  ring: {
    flex: 1,
    borderRadius: 23,
    padding: 1,
  },
  avatar: {
    flex: 1,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(14,20,36,0.7)',
  },
  initials: {
    color: '#f0f5ff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
});
