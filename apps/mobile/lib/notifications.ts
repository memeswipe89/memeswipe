import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

const TRADE_CHANNEL_ID = 'trade-events';
let initialized = false;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const initializeNotifications = async () => {
  if (initialized) return;

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
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status !== 'granted') return false;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Trade Closed',
      body: `${symbol.toUpperCase()} ${pnlUsd >= 0 ? 'closed in profit' : 'closed in loss'} (${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(4)}).`,
      sound: 'default',
      ...(Platform.OS === 'android' ? { channelId: TRADE_CHANNEL_ID } : {}),
    },
    trigger: null,
  });

  return true;
};
