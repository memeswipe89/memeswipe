import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@memeswipe:trade-settings:v1';

/**
 * Check if haptics are enabled in user settings
 */
export const isHapticsEnabled = async (): Promise<boolean> => {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return true; // Default to enabled
    const settings = JSON.parse(raw);
    return settings.hapticsEnabled !== false; // Default to true if not set
  } catch {
    return true; // Default to enabled on error
  }
};

/**
 * Trigger haptic feedback only if enabled in settings
 */
export const triggerHaptic = async (
  type: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error'
) => {
  const enabled = await isHapticsEnabled();
  if (!enabled) return;

  try {
    switch (type) {
      case 'light':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        break;
      case 'medium':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        break;
      case 'heavy':
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        break;
      case 'selection':
        await Haptics.selectionAsync();
        break;
      case 'success':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        break;
      case 'warning':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        break;
      case 'error':
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        break;
    }
  } catch (error) {
    // Silently fail - haptics are not critical
    console.log('Haptic feedback failed:', error);
  }
};

/**
 * Synchronous version - use when you have hapticsEnabled from context
 */
export const triggerHapticSync = (
  enabled: boolean,
  type: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error'
) => {
  if (!enabled) return;

  try {
    switch (type) {
      case 'light':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        break;
      case 'medium':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
        break;
      case 'heavy':
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
        break;
      case 'selection':
        Haptics.selectionAsync().catch(() => undefined);
        break;
      case 'success':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
        break;
      case 'warning':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        break;
      case 'error':
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
        break;
    }
  } catch (error) {
    // Silently fail
  }
};
