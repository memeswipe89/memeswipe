import { Platform } from 'react-native';

const TRADE_CHANNEL_ID = 'trade-events';
let initialized = false;
const isWeb = Platform.OS === 'web';

let Notifications: typeof import('expo-notifications') | null = null;

if (!isWeb) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  Notifications = require('expo-notifications');
  Notifications!.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export const initializeNotifications = async () => {
  if (isWeb || initialized || Notifications == null) return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(TRADE_CHANNEL_ID, {
      name: 'Trade Events',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 200, 250],
      lightColor: '#4ade80',
      sound: 'default',
    });
  }

  let permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') {
    permissions = await Notifications.requestPermissionsAsync();
  }

  initialized = true;
};

export const notifyTradeClosed = async ({
  symbol,
  pnlUsd,
}: {
  symbol: string;
  pnlUsd: number;
}) => {
  if (isWeb || Notifications == null) return false;
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Trade Closed',
      body: `${symbol.toUpperCase()} ${
        pnlUsd >= 0 ? 'closed in profit' : 'closed in loss'
      } (${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(4)}).`,
      sound: 'default',
      ...(Platform.OS === 'android' ? { channelId: TRADE_CHANNEL_ID } : {}),
    },
    trigger: null,
  });

  return true;
};
