#!/bin/bash

echo "🧹 Clearing all Expo and Metro caches..."

# Clear Expo cache
rm -rf .expo
echo "✅ Cleared .expo"

# Clear Metro bundler cache
rm -rf node_modules/.cache
echo "✅ Cleared node_modules/.cache"

# Clear Metro temp files
rm -rf /tmp/metro-* 2>/dev/null
rm -rf /tmp/haste-* 2>/dev/null
echo "✅ Cleared Metro temp files"

# Clear React Native cache
rm -rf $TMPDIR/react-* 2>/dev/null
echo "✅ Cleared React Native cache"

echo ""
echo "✨ All caches cleared!"
echo ""
echo "Now run: npx expo start --clear --reset-cache"
echo ""
echo "Then:"
echo "  1. Delete the app from your device/simulator"
echo "  2. Press 'i' (iOS) or 'a' (Android) to reinstall"
echo ""
