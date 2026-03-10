import Constants from "expo-constants";

const FALLBACK_API_BASE = "https://memeswipe.onrender.com";

const normalizeApiBase = (value?: string) => {
  if (!value) return FALLBACK_API_BASE;
  const trimmed = value.trim();
  if (trimmed.startsWith("ttps://")) return `h${trimmed}`;
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
  return `https://${trimmed}`;
};

const extraConfig =
  (Constants.expoConfig?.extra as { apiBase?: string; jupApiKey?: string } | undefined) ||
  (Constants as any)?.manifest2?.extra?.expoClient?.extra ||
  {};
const extraApiBase = extraConfig?.apiBase;

export const API_BASE = normalizeApiBase(process.env.EXPO_PUBLIC_API_BASE || extraApiBase);
export const JUP_API_KEY = process.env.EXPO_PUBLIC_JUP_API_KEY || extraConfig?.jupApiKey || "";
