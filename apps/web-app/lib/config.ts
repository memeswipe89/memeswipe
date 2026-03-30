export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "https://example.onrender.com";
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
export const PRIVY_CLIENT_ID = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID ?? "";
export const isPrivyConfigured = Boolean(PRIVY_APP_ID && PRIVY_CLIENT_ID);
