import AsyncStorage from "@react-native-async-storage/async-storage";

export const LOCAL_USER_ID_KEY = "@memeswipe:userId:v1";
export const USER_ID_MAP_PREFIX = "@memeswipe:userId:privy:";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function persistLocalUserId(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(LOCAL_USER_ID_KEY, userId);
  } catch (error) {
    console.warn("persistLocalUserId failed:", error);
  }
}

export async function persistPrivyUserIdMapping(privyUserId: string, userId: string): Promise<void> {
  if (!privyUserId || !userId) return;
  try {
    await AsyncStorage.setItem(`${USER_ID_MAP_PREFIX}${privyUserId}`, userId);
  } catch (error) {
    console.warn("persistPrivyUserIdMapping failed:", error);
  }
}

export async function persistUserIds(userId: string, privyUserId?: string): Promise<void> {
  if (!userId) return;
  await persistLocalUserId(userId);
  if (privyUserId) {
    await persistPrivyUserIdMapping(privyUserId, userId);
  }
}
