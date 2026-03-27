const Application = {
  applicationId: "web.memeswipe.app",
  applicationName: "Memeswipe",
  nativeApplicationVersion: "1.0.0",
  nativeBuildVersion: "1",

  getApplicationIdAsync: async () => "web.memeswipe.app",
  getIosIdForVendorAsync: async () => "web",
  getAndroidIdAsync: async () => "web",
};

export default Application;
export const {
  applicationId,
  applicationName,
  nativeApplicationVersion,
  nativeBuildVersion,
  getApplicationIdAsync,
  getIosIdForVendorAsync,
  getAndroidIdAsync,
} = Application;