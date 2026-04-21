# Swipe Sound Effects

This directory is for custom swipe sound effects. Currently, the app uses minimal placeholder sounds.

## Adding Custom Sounds

To add custom sound effects:

1. **Add sound files** to this directory:
   - `swipe-right.mp3` - For buy/accept swipes (success sound)
   - `swipe-left.mp3` - For reject swipes (neutral sound)
   - `swipe-up.mp3` - For favorite swipes (special sound)

2. **Update the code** in `components/swipe-token-deck.tsx`:

Replace the placeholder sound loading with:

```typescript
const playSwipeSound = useCallback(async (direction: 'left' | 'right' | 'up') => {
  if (!audioInitialized.current) return;

  try {
    let soundFile;
    let volume;
    
    if (direction === 'right') {
      soundFile = require('../assets/sounds/swipe-right.mp3');
      volume = 0.5;
    } else if (direction === 'up') {
      soundFile = require('../assets/sounds/swipe-up.mp3');
      volume = 0.4;
    } else {
      soundFile = require('../assets/sounds/swipe-left.mp3');
      volume = 0.3;
    }
    
    const { sound } = await Audio.Sound.createAsync(
      soundFile,
      { shouldPlay: true, volume },
      (status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
        }
      }
    );
  } catch (error) {
    console.log('Failed to play swipe sound:', error);
  }
}, []);
```

## Sound Recommendations

- **Format**: MP3 or WAV
- **Duration**: 100-300ms (short and snappy)
- **Sample Rate**: 44.1kHz
- **Bit Rate**: 128kbps or higher
- **Volume**: Pre-normalized to avoid clipping

### Suggested Sound Types

- **Swipe Right (Buy)**: Upward chime, success bell, or positive "ding"
- **Swipe Left (Reject)**: Neutral whoosh, soft tap, or subtle "pop"
- **Swipe Up (Favorite)**: Special chime, heart sound, or distinctive "ping"

## Free Sound Resources

- [Freesound.org](https://freesound.org/)
- [Zapsplat](https://www.zapsplat.com/)
- [Mixkit](https://mixkit.co/free-sound-effects/)

## Current Implementation

The app currently uses:
- Haptic feedback (vibration) for all swipes
- Minimal placeholder audio (empty WAV data)
- Different haptic intensities for different swipe directions

This provides good feedback without requiring large audio files in the bundle.
