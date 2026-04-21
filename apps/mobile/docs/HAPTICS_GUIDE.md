# Haptics Guide

Haptics (vibration feedback) are **completely free** to use - they're a native device feature with no API costs or limits.

## Current Implementation

The app uses haptics for swipe feedback:

- **Swipe Right (Buy)**: Success notification - strong, positive feedback
- **Swipe Up (Favorite)**: Medium impact - moderate feedback  
- **Swipe Left (Reject)**: Light impact - subtle feedback

## Available Haptic Types

### 1. Impact Feedback
Physical impact simulation - best for UI interactions:

```typescript
import * as Haptics from 'expo-haptics';

// Light - Subtle tap (currently used for reject)
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

// Medium - Moderate impact (currently used for favorite)
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

// Heavy - Strong impact
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

// Rigid - Firm, precise feedback
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);

// Soft - Gentle, cushioned feedback
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
```

### 2. Notification Feedback
System-level notifications - best for success/error states:

```typescript
// Success - Positive outcome (currently used for buy)
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

// Warning - Caution needed
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

// Error - Something went wrong
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
```

### 3. Selection Feedback
For scrolling through options:

```typescript
// Light tick - Good for picker wheels, sliders
Haptics.selectionAsync();
```

## Best Practices

### ✅ Do
- Use haptics to **confirm actions** (button presses, swipes)
- Match **intensity to importance** (light for minor, heavy for major)
- Combine with **visual feedback** (animations, color changes)
- Use **different patterns** for different actions
- Keep haptics **brief** (< 100ms)

### ❌ Don't
- Overuse haptics (causes fatigue)
- Use for every UI element
- Use heavy haptics for minor actions
- Ignore user preferences (some disable haptics)
- Use haptics for continuous feedback

## Platform Support

| Platform | Support | Notes |
|----------|---------|-------|
| iOS | ✅ Full | All haptic types supported |
| Android | ✅ Full | May vary by device |
| Web | ⚠️ Limited | Basic vibration only |

## Performance

- **Battery Impact**: Minimal (< 1% per hour of use)
- **Latency**: < 10ms on modern devices
- **Cost**: **FREE** - No API limits or charges
- **Offline**: Works without internet

## Example Enhancements

### Add Haptics to Buttons

```typescript
<Pressable
  onPress={() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    handlePress();
  }}
>
  <Text>Press Me</Text>
</Pressable>
```

### Add Haptics to Toggle

```typescript
const handleToggle = () => {
  Haptics.selectionAsync();
  setEnabled(!enabled);
};
```

### Add Haptics to Errors

```typescript
const handleError = () => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  showErrorMessage();
};
```

## User Settings

Consider adding a setting to disable haptics:

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage';

const HAPTICS_ENABLED_KEY = '@app:hapticsEnabled';

// Save preference
await AsyncStorage.setItem(HAPTICS_ENABLED_KEY, 'true');

// Check before triggering
const enabled = await AsyncStorage.getItem(HAPTICS_ENABLED_KEY);
if (enabled !== 'false') {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}
```

## Resources

- [Expo Haptics Docs](https://docs.expo.dev/versions/latest/sdk/haptics/)
- [iOS Human Interface Guidelines - Haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)
- [Android Haptics Guidelines](https://developer.android.com/develop/ui/views/haptics)

## Summary

✅ **Haptics are FREE** - Use them liberally!  
✅ **No API costs** - Native device feature  
✅ **Great UX** - Makes apps feel responsive  
✅ **Easy to implement** - Simple API  
✅ **Works offline** - No internet needed
