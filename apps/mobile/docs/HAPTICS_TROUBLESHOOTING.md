# Haptics Troubleshooting Guide

## Issue: Can't Feel Haptics During Testing

### Quick Checklist

#### 1. **Device Requirements**
- [ ] Testing on a **physical device** (not simulator/emulator)
- [ ] iOS: iPhone 7 or newer (has Taptic Engine)
- [ ] Android: Device with vibration motor

⚠️ **IMPORTANT**: Haptics **DO NOT WORK** in iOS Simulator or Android Emulator!

#### 2. **System Settings**

**iOS:**
- [ ] Settings → Sounds & Haptics → System Haptics is **ON**
- [ ] Settings → Accessibility → Touch → Vibration is **ON**
- [ ] Ring/Silent switch is not on Silent (some haptics are muted in silent mode)
- [ ] Low Power Mode is **OFF** (can disable haptics)

**Android:**
- [ ] Settings → Sound & vibration → Vibration & haptics is **ON**
- [ ] Settings → Accessibility → Vibration is **ON**
- [ ] Battery Saver mode is **OFF**

#### 3. **App Configuration**
- [ ] `expo-haptics` package is installed (check package.json)
- [ ] App is running on a development build (not Expo Go for best results)
- [ ] No errors in console logs

### Testing Steps

#### Step 1: Check Console Logs

After adding the logging code, check your console for:
```
Age confirm pressed - triggering haptics
Haptics success notification triggered
```

If you see errors, note what they say.

#### Step 2: Run Haptics Test

Add this to your onboarding screen temporarily:

```typescript
import { testAllHaptics, checkHapticsSupport } from '@/lib/haptics-test';

// Add a test button
<Pressable 
  style={{ padding: 20, backgroundColor: '#007AFF', margin: 20 }}
  onPress={async () => {
    checkHapticsSupport();
    await testAllHaptics();
  }}
>
  <Text style={{ color: '#fff' }}>Test All Haptics</Text>
</Pressable>
```

This will test all haptic types and log results to console.

#### Step 3: Test Individual Haptics

Try the simplest haptic first:

```typescript
import * as Haptics from 'expo-haptics';

<Pressable onPress={() => {
  console.log('Button pressed');
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
    .then(() => console.log('Heavy impact triggered'))
    .catch(err => console.error('Haptics error:', err));
}}>
  <Text>Test Heavy Impact</Text>
</Pressable>
```

Heavy impact is the strongest and easiest to feel.

### Common Issues & Solutions

#### Issue 1: "Testing in Simulator"
**Solution**: Haptics only work on physical devices. Deploy to a real iPhone or Android phone.

```bash
# iOS
npx expo run:ios --device

# Android
npx expo run:android --device
```

#### Issue 2: "Expo Go Limitations"
**Solution**: Some haptics may not work properly in Expo Go. Create a development build:

```bash
# Install expo-dev-client
npx expo install expo-dev-client

# Create development build
eas build --profile development --platform ios
# or
eas build --profile development --platform android
```

#### Issue 3: "Silent Mode on iOS"
**Solution**: Some haptic types are muted when the iPhone is in silent mode. Toggle the ring/silent switch.

#### Issue 4: "Weak Vibration Motor"
**Solution**: Some Android devices have weak vibration motors. Try:
- Using `Heavy` impact instead of `Light`
- Using `notificationAsync` instead of `impactAsync`
- Testing on a different device

#### Issue 5: "Battery Saver Mode"
**Solution**: Disable Low Power Mode (iOS) or Battery Saver (Android) as they can disable haptics.

#### Issue 6: "Accessibility Settings"
**Solution**: Check if haptics/vibration is disabled in accessibility settings.

### Platform-Specific Notes

#### iOS
- **Best Support**: iPhone 7 and newer have the Taptic Engine
- **Older Devices**: iPhone 6s and older have basic vibration only
- **Silent Mode**: Some haptics are muted in silent mode
- **Simulator**: Haptics don't work at all

#### Android
- **Varies by Device**: Haptic quality depends on the vibration motor
- **Permissions**: No special permissions needed for haptics
- **Emulator**: Haptics don't work at all
- **Custom ROMs**: Some custom ROMs may have haptics disabled

#### Web
- **Limited Support**: Only basic vibration API
- **Browser Support**: Not all browsers support vibration
- **Desktop**: No haptics on desktop browsers

### Verification Commands

```bash
# Check if expo-haptics is installed
npm list expo-haptics

# Should show: expo-haptics@15.0.8 or similar

# Reinstall if needed
npx expo install expo-haptics

# Clear cache and rebuild
npx expo start --clear
```

### Debug Mode

Add this to see detailed haptics info:

```typescript
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

console.log('Platform:', Platform.OS);
console.log('Platform Version:', Platform.Version);

// Test haptics
const testHaptic = async () => {
  try {
    console.log('Attempting haptic...');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    console.log('Haptic succeeded!');
  } catch (error) {
    console.error('Haptic failed:', error);
  }
};
```

### Still Not Working?

1. **Verify device hardware**: Test haptics in other apps (keyboard, system UI)
2. **Check device settings**: Ensure vibration is enabled system-wide
3. **Try different haptic types**: Some devices support certain types better
4. **Update Expo SDK**: Ensure you're on a recent Expo SDK version
5. **Check device compatibility**: Some devices have haptics disabled by manufacturer

### Quick Test Code

Add this button to quickly test if haptics work at all:

```typescript
<Pressable
  style={{
    padding: 20,
    backgroundColor: '#ff0000',
    margin: 20,
    borderRadius: 10,
  }}
  onPress={async () => {
    console.log('=== HAPTICS TEST ===');
    
    // Test 1: Heavy Impact (easiest to feel)
    console.log('Test 1: Heavy Impact');
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    await new Promise(r => setTimeout(r, 1000));
    
    // Test 2: Success Notification
    console.log('Test 2: Success Notification');
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await new Promise(r => setTimeout(r, 1000));
    
    // Test 3: Multiple Light Impacts
    console.log('Test 3: Multiple Light Impacts');
    for (let i = 0; i < 3; i++) {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await new Promise(r => setTimeout(r, 200));
    }
    
    console.log('=== TEST COMPLETE ===');
  }}
>
  <Text style={{ color: '#fff', fontWeight: 'bold' }}>
    🔴 TEST HAPTICS (Check Console)
  </Text>
</Pressable>
```

### Expected Behavior

When haptics work correctly:
- **Light Impact**: Subtle tap feeling
- **Medium Impact**: Moderate tap feeling
- **Heavy Impact**: Strong tap feeling (easiest to feel)
- **Success**: Distinct "success" pattern
- **Warning**: Distinct "warning" pattern
- **Error**: Distinct "error" pattern
- **Selection**: Light tick (like scrolling a picker)

### Contact Support

If haptics still don't work after trying all steps:
1. Note your device model and OS version
2. Check console logs for errors
3. Verify haptics work in other apps
4. Share console output from the test code above
