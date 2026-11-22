import { buttonClassName } from '@archova/ui';
import { ANDROID_TEST_APK_URL, IOS_TEST_IPA_URL } from '../lib/app-download';

// The Android and iPhone test-build download cards, shared by the landing page and /app.
export function AppDownloadCards({ headingLevel = 2 }: { headingLevel?: 2 | 3 }) {
  const Heading = `h${headingLevel}` as const;
  return (
    <ul className="grid">
      <li className="card">
        <Heading>Android test build</Heading>
        <p className="notice">
          <strong>Test build.</strong> This is not an app-store release. It is signed for testing
          only, so Android will ask you to allow installs from your browser.
        </p>
        <p>
          <a className={buttonClassName('primary')} href={ANDROID_TEST_APK_URL} download>
            Download the Android APK
          </a>
        </p>
        <ol>
          <li>Open this page on your Android phone and tap Download.</li>
          <li>Open the downloaded file and allow installs from this browser if asked.</li>
          <li>Sign in with your Archova account.</li>
        </ol>
      </li>
      <li className="card">
        <Heading>iPhone and iPad test build</Heading>
        <p className="notice">
          <strong>Test build.</strong> This is not an App Store release. The file is unsigned, so it
          has to be installed with a sideloading tool, and an install made with a free Apple ID
          stops working after 7 days. Not yet tested on a real device.
        </p>
        <p>
          <a className={buttonClassName('primary')} href={IOS_TEST_IPA_URL} download>
            Download the iPhone IPA
          </a>
        </p>
        <ol>
          <li>Download the file on a computer.</li>
          <li>Install Sideloadly and sign in with a free Apple ID.</li>
          <li>Connect your iPhone, drag the IPA into Sideloadly and tap Start.</li>
          <li>Trust the app in Settings, then General, then VPN and Device Management.</li>
        </ol>
        <p>No computer? Open Archova in Safari and use Share, then Add to Home Screen.</p>
      </li>
    </ul>
  );
}
