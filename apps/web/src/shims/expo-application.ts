const SAFE_APPLICATION_ID = "web.memeswipe.app";
const SAFE_APPLICATION_NAME = "Memeswipe Web";
const SAFE_APP_VERSION = "0.0.0";
const SAFE_BUILD_VERSION = "0";
const SAFE_ANDROID_ID = "web";
const SAFE_REFERRER_URL = "https://memeswipe.app";
const now = () => new Date();

export enum ApplicationReleaseType {
  UNKNOWN = 0,
  SIMULATOR = 1,
  ENTERPRISE = 2,
  DEVELOPMENT = 3,
  AD_HOC = 4,
  APP_STORE = 5,
}

export type PushNotificationServiceEnvironment = "development" | "production" | null;

const SAFE_PUSH_ENV: PushNotificationServiceEnvironment = "development";

const resolveAsync = <T>(value: T): Promise<T> => Promise.resolve(value);

export const applicationId = SAFE_APPLICATION_ID;
export const applicationName = SAFE_APPLICATION_NAME;
export const nativeApplicationVersion = SAFE_APP_VERSION;
export const nativeBuildVersion = SAFE_BUILD_VERSION;

export function getApplicationIdAsync(): Promise<string> {
  return resolveAsync(applicationId);
}

export function getAndroidId(): string {
  return SAFE_ANDROID_ID;
}

export function getAndroidIdAsync(): Promise<string> {
  return resolveAsync(SAFE_ANDROID_ID);
}

export function getInstallReferrerAsync(): Promise<string> {
  return resolveAsync(SAFE_REFERRER_URL);
}

export function getIosIdForVendorAsync(): Promise<string> {
  return resolveAsync(SAFE_APPLICATION_ID);
}

export function getIosApplicationReleaseTypeAsync(): Promise<ApplicationReleaseType> {
  return resolveAsync(ApplicationReleaseType.UNKNOWN);
}

export function getIosPushNotificationServiceEnvironmentAsync(): Promise<PushNotificationServiceEnvironment> {
  return resolveAsync(SAFE_PUSH_ENV);
}

export function getInstallationTimeAsync(): Promise<Date> {
  return resolveAsync(now());
}

export function getLastUpdateTimeAsync(): Promise<Date> {
  return resolveAsync(now());
}

const webApplicationShim = {
  applicationId,
  applicationName,
  nativeApplicationVersion,
  nativeBuildVersion,
  getAndroidId,
  getAndroidIdAsync,
  getApplicationIdAsync,
  getInstallReferrerAsync,
  getIosIdForVendorAsync,
  getIosApplicationReleaseTypeAsync,
  getIosPushNotificationServiceEnvironmentAsync,
  getInstallationTimeAsync,
  getLastUpdateTimeAsync,
};

export default webApplicationShim;
