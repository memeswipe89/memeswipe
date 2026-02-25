import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@memeswipe:dev-balance';

export async function getBalance(): Promise<number> {
  const value = await AsyncStorage.getItem(KEY);
  return value ? Number(value) : 1000;
}

export async function setBalance(amount: number) {
  await AsyncStorage.setItem(KEY, String(amount));
}

export async function deductBalance(amount: number) {
  const current = await getBalance();
  const updated = Math.max(0, current - amount);
  await setBalance(updated);
  return updated;
}

export async function addBalance(amount: number) {
  const current = await getBalance();
  const updated = current + amount;
  await setBalance(updated);
  return updated;
}

export async function resetBalance() {
  await setBalance(1000);
}

