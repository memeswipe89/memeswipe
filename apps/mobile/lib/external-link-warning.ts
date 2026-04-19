import { Alert, Linking } from 'react-native';

/**
 * Opens an external URL with a warning dialog
 * @param url - The URL to open
 * @param options - Optional configuration
 */
export async function openExternalLink(
  url: string,
  options?: {
    skipWarning?: boolean;
    title?: string;
    message?: string;
  }
): Promise<boolean> {
  const { skipWarning = false, title, message } = options || {};

  // Skip warning for certain safe URLs (email, tel, etc.)
  if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('sms:')) {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Show warning dialog
  if (!skipWarning) {
    return new Promise((resolve) => {
      Alert.alert(
        title || 'Leaving Swipeit',
        message || 'You are about to open an external link. This will take you outside the app.',
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => resolve(false),
          },
          {
            text: 'Continue',
            onPress: async () => {
              try {
                const canOpen = await Linking.canOpenURL(url);
                if (canOpen) {
                  await Linking.openURL(url);
                  resolve(true);
                } else {
                  resolve(false);
                }
              } catch {
                resolve(false);
              }
            },
          },
        ]
      );
    });
  }

  // Skip warning - open directly
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) {
      await Linking.openURL(url);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Opens an external URL silently (without warning) - use for deep links and app-to-app navigation
 */
export async function openExternalLinkSilent(url: string): Promise<boolean> {
  return openExternalLink(url, { skipWarning: true });
}
