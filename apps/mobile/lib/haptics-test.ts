import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Test all haptics types to verify they work on the device
 */
export const testAllHaptics = async () => {
  console.log('=== HAPTICS TEST START ===');
  console.log('Platform:', Platform.OS);
  console.log('Platform Version:', Platform.Version);

  try {
    // Test Impact - Light
    console.log('Testing Light Impact...');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await delay(500);

    // Test Impact - Medium
    console.log('Testing Medium Impact...');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await delay(500);

    // Test Impact - Heavy
    console.log('Testing Heavy Impact...');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await delay(500);

    // Test Selection
    console.log('Testing Selection...');
    await Haptics.selectionAsync();
    await delay(500);

    // Test Notification - Success
    console.log('Testing Success Notification...');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await delay(500);

    // Test Notification - Warning
    console.log('Testing Warning Notification...');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await delay(500);

    // Test Notification - Error
    console.log('Testing Error Notification...');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

    console.log('=== HAPTICS TEST COMPLETE ===');
    console.log('All haptics triggered successfully!');
    return true;
  } catch (error) {
    console.error('=== HAPTICS TEST FAILED ===');
    console.error('Error:', error);
    return false;
  }
};

/**
 * Check if haptics are supported on the device
 */
export const checkHapticsSupport = () => {
  console.log('=== HAPTICS SUPPORT CHECK ===');
  console.log('Platform:', Platform.OS);
  
  if (Platform.OS === 'ios') {
    console.log('iOS detected - Haptics should be supported on iPhone 7+');
    return true;
  } else if (Platform.OS === 'android') {
    console.log('Android detected - Haptics support varies by device');
    return true;
  } else if (Platform.OS === 'web') {
    console.log('Web detected - Limited haptics support (basic vibration only)');
    return false;
  }
  
  console.log('Unknown platform - Haptics may not be supported');
  return false;
};

/**
 * Simple delay helper
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Test a single haptic type
 */
export const testSingleHaptic = async (type: 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error') => {
  console.log(`Testing ${type} haptic...`);
  
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
    console.log(`${type} haptic triggered successfully`);
    return true;
  } catch (error) {
    console.error(`${type} haptic failed:`, error);
    return false;
  }
};
