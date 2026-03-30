"use client";

import { API_URL } from "./config";

export type TwitterConnectionStatus = {
  connected: boolean;
  twitterUsername?: string;
  twitterUserId?: string;
};

export async function checkTwitterConnection(userId: string): Promise<TwitterConnectionStatus> {
  if (!userId) {
    return { connected: false };
  }
  const response = await fetch(`${API_URL}/api/twitter/connection/${encodeURIComponent(userId)}`, {
    cache: "no-store",
  });
  if (response.status === 404) {
    return { connected: false };
  }
  if (!response.ok) {
    throw new Error("Unable to verify Twitter connection");
  }
  return (await response.json()) as TwitterConnectionStatus;
}

export async function startTwitterConnection(userId: string, returnUrl: string): Promise<string> {
  if (!userId) {
    throw new Error("Missing user id");
  }
  const params = new URLSearchParams({
    userId,
    returnUrl,
  });
  const response = await fetch(`${API_URL}/api/twitter/auth/start?${params.toString()}`);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error || "Unable to start Twitter flow");
  }
  const data = await response.json();
  if (!data?.authUrl) {
    throw new Error("Invalid Twitter auth response");
  }
  return data.authUrl;
}

export type TwitterCallbackResult = {
  status: "success" | "error";
  error?: string;
  reason?: string;
  twitterUsername?: string;
  twitterUserId?: string;
  userId?: string;
};

export function parseTwitterCallback(query: URLSearchParams): TwitterCallbackResult | null {
  const status = query.get("status");
  if (!status) return null;
  if (status === "success") {
    const twitterUsername = query.get("twitterUsername") || undefined;
    const twitterUserId = query.get("twitterUserId") || undefined;
    const userId = query.get("userId") || undefined;
    return {
      status: "success",
      twitterUsername,
      twitterUserId,
      userId,
    };
  }
  return {
    status: "error",
    error: query.get("error") || undefined,
    reason: query.get("reason") || undefined,
  };
}
