const appJson = require('../app.json');

const bundleIds =
  (appJson?.expo?.ios?.bundleIdentifier ? [appJson.expo.ios.bundleIdentifier] : []) ??
  [];
const packageIds =
  (appJson?.expo?.android?.package ? [appJson.expo.android.package] : []) ?? [];

const fallbackAppId =
  bundleIds[0] || packageIds[0] || 'com.memeswipe.mobile';

export const applicationId = fallbackAppId;
export const applicationName = null;
export const nativeApplicationVersion = null;
export const nativeBuildVersion = null;

export default {
  applicationId,
  applicationName,
  nativeApplicationVersion,
  nativeBuildVersion,
};
