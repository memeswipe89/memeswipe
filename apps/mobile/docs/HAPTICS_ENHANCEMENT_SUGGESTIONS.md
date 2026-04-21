# Haptics Enhancement Suggestions

Here are recommended places to add haptic feedback throughout the app for better UX.

## ✅ Already Implemented

- ✅ Swipe Right (Buy) - Success notification
- ✅ Swipe Up (Favorite) - Medium impact
- ✅ Swipe Left (Reject) - Light impact

## 🎯 Recommended Additions

### 1. Navigation & Tabs

**Segment/Tab Switching**
```typescript
// When switching between trending/stalker/bigcap/smart
onPress={() => {
  Haptics.selectionAsync(); // Light tick for selection
  setSegment('trending');
}}
```

**Source Tab (Pump.fun / Bags)**
```typescript
onPress={() => {
  Haptics.selectionAsync(); // Light tick
  setActiveSource('pumpfun');
}}
```

**Favorites Toggle**
```typescript
onPress={() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  setSegment(prev => prev === 'favorites' ? 'trending' : 'favorites');
}}
```

### 2. Wallet & Balance

**Open Wallet Sheet**
```typescript
onPress={() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  walletSheetRef.current?.open();
}}
```

**Deposit Button**
```typescript
onPress={() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  router.push('/deposit');
}}
```

### 3. Trade Settings

**Edit Amount/ROI/Stop Loss**
```typescript
onPress={() => {
  Haptics.selectionAsync(); // Light tick for opening editor
  openEdit('AMT');
}}
```

**Save Settings**
```typescript
onPress={() => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  confirmEdit();
}}
```

**Cancel Edit**
```typescript
onPress={() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  setEditField(null);
}}
```

### 4. Modals & Popups

**Close Modal**
```typescript
onPress={() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  setTradeOpenPopup(prev => ({ ...prev, visible: false }));
}}
```

**Checkbox Toggle**
```typescript
onPress={() => {
  Haptics.selectionAsync(); // Perfect for checkboxes
  handleNeverShowAgain();
}}
```

### 5. Profile & Settings

**Open Profile Sheet**
```typescript
onPress={() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  profileSheetRef.current?.open();
}}
```

**Toggle Settings**
```typescript
onPress={() => {
  Haptics.selectionAsync();
  toggleSetting();
}}
```

### 6. Social Actions

**Connect Twitter**
```typescript
onPress={() => {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  connectTwitter();
}}
```

**Copy Address**
```typescript
onPress={() => {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  Clipboard.setString(address);
  setCopied(true);
}}
```

### 7. Error States

**Trade Failed**
```typescript
// In error handler
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
Alert.alert('Trade Failed', errorMessage);
```

**Insufficient Balance**
```typescript
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
Alert.alert('Insufficient Balance', 'Please add funds to continue');
```

### 8. Success States

**Trade Completed**
```typescript
// Already has haptics in swipe, but could add to confirmation
Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
setTradeOpenPopup({ visible: true, ... });
```

**Favorite Added**
```typescript
Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
// Show favorite popup
```

## Implementation Priority

### High Priority (Most Impact)
1. ✅ Swipe actions (already done)
2. Tab/segment switching
3. Wallet interactions
4. Trade confirmations
5. Error notifications

### Medium Priority
6. Edit modals (open/save/cancel)
7. Checkbox toggles
8. Copy actions
9. Profile sheet

### Low Priority (Nice to Have)
10. Hover states (web only)
11. Long press actions
12. Scroll feedback

## Code Example: Adding to SimplePill

```typescript
const SimplePill = ({ label, value, onPress }: SimplePillProps) => (
  <Pressable 
    style={styles.simplePill} 
    onPress={() => {
      Haptics.selectionAsync(); // Add this line
      onPress();
    }}
  >
    <Text style={styles.simplePillLabel}>{label}</Text>
    <Text style={styles.simplePillValue}>{value}</Text>
  </Pressable>
);
```

## Code Example: Adding to SourceTab

```typescript
const SourceTab = ({ label, enabled, onPress }: SourceTabProps) => (
  <Pressable
    onPress={() => {
      if (!enabled) { // Only haptic when changing
        Haptics.selectionAsync();
      }
      onPress();
    }}
    style={[styles.sourceTab, enabled && styles.sourceTabActive]}
  >
    <Text style={[styles.sourceTabText, enabled && styles.sourceTabTextActive]}>
      {label}
    </Text>
  </Pressable>
);
```

## Testing Checklist

- [ ] Test on iOS device (best haptic support)
- [ ] Test on Android device (varies by manufacturer)
- [ ] Verify haptics don't fire too frequently
- [ ] Check battery impact during extended use
- [ ] Ensure haptics match action importance
- [ ] Test with device haptics disabled
- [ ] Verify no performance issues

## Summary

**Total Haptic Opportunities**: ~20-25 interactions  
**Currently Implemented**: 3 (swipe actions)  
**Recommended Next**: 10-12 high-priority additions  
**Estimated Implementation Time**: 1-2 hours  
**Cost**: **$0.00** (completely free!)

Remember: Haptics are free, but use them thoughtfully. Every haptic should have a purpose and match the action's importance.
