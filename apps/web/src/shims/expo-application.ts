const BUNDLE_ID = process.env.EXPO_IOS_BUNDLE_ID || "com.memeswipe.web";
const PACKAGE_NAME = process.env.EXPO_ANDROID_PACKAGE || "com.memeswipe.web";

export const ios = { bundleId: BUNDLE_ID };
export const android = { package: PACKAGE_NAME };
export const applicationId = BUNDLE_ID;
export const nativeApplicationVersion = process.env.EXPO_NATIVE_APPLICATION_VERSION || "1.0.0";

export async function getIosApplicationIdAsync() {
  return BUNDLE_ID;
}

export async function getAndroidApplicationIdAsync() {
  return PACKAGE_NAME;
}

export function getApplicationIdAsync() {
  return Promise.resolve(applicationId);
}

const defaultExport = {
  ios,
  android,
  applicationId,
  nativeApplicationVersion,
  getIosApplicationIdAsync,
  getAndroidApplicationIdAsync,
  getApplicationIdAsync,
};

export default defaultExport;
