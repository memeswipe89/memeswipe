const SAFETY_WEB_IDENTIFIER = "web.memeswipe.app";
const FALLBACK_APPLICATION_ID = "com.memeswipe.mobile";
const isWeb = typeof window !== "undefined";

/**
 * Returns an application identifier that is safe to use on both web and native.
 */
export function getSafeAppId(): string {
  if (isWeb) {
    return SAFETY_WEB_IDENTIFIER;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Application = require("expo-application") as { applicationId?: string };
    const appId = Application?.applicationId;
    if (typeof appId === "string" && appId.length > 0) {
      return appId;
    }
  } catch {
    // fall back to default when the module is unavailable.
  }
  return FALLBACK_APPLICATION_ID;
}

export { isWeb };
