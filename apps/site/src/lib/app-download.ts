// Stable link to the newest Android test APK. The "Mobile APK" workflow overwrites this release asset on every run.
// Override with APP_ANDROID_APK_URL if the file is hosted elsewhere.
export const ANDROID_TEST_APK_URL =
  process.env.APP_ANDROID_APK_URL ??
  'https://github.com/tradeaiapps-collab/archova/releases/download/android-test-latest/archova-android-test.apk';

// Stable link to the newest unsigned iPhone test build (.ipa), replaced on every iOS build run.
// Override with APP_IOS_IPA_URL if the file is hosted elsewhere.
export const IOS_TEST_IPA_URL =
  process.env.APP_IOS_IPA_URL ??
  'https://github.com/tradeaiapps-collab/archova/releases/download/ios-test-latest/archova-ios-test.ipa';
