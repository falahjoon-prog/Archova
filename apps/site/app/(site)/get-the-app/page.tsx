import type { Metadata } from 'next';
import { buttonClassName } from '@archova/ui';

export const metadata: Metadata = {
  title: 'Get the app',
  description: 'Install the Archova site app on your Android phone or iPhone.',
};

// The files sit in apps/site/public/downloads (not in git: they are large test builds). Set the env vars to point
// somewhere else, such as a file store, once the app is in the stores.
const ANDROID_URL = process.env.SITE_ANDROID_APK_URL ?? '/downloads/archova.apk';
const IOS_URL = process.env.SITE_IOS_IPA_URL ?? '/downloads/archova-ios.ipa';

export default function GetTheAppPage() {
  return (
    <div className="narrow">
      <h1>Get the Archova app</h1>
      <p>
        Diary, defects, drawings, site sign-in and photos on your phone, working even without
        signal. These are test builds for the pilot, not store releases.
      </p>

      <h2>Android</h2>
      <p>
        <a className={buttonClassName('primary')} href={ANDROID_URL} download>
          Download for Android
        </a>
      </p>
      <ol>
        <li>Tap the button and open the downloaded file.</li>
        <li>If your phone asks, allow installs from this source.</li>
        <li>Open Archova and tap Sign in.</li>
      </ol>

      <h2>iPhone</h2>
      <p>
        <a className={buttonClassName('secondary')} href={IOS_URL} download>
          Download for iPhone (test build)
        </a>
      </p>
      <p>
        Apple only lets store apps install in one tap. Until Archova is in the App Store, the iPhone
        test build is installed from a computer with a free tool called Sideloadly, which signs it
        with your Apple ID for 7 days.
      </p>
      <ol>
        <li>Install Sideloadly on your Windows PC or Mac and plug in your iPhone.</li>
        <li>Download the iPhone file above to the computer and drag it into Sideloadly.</li>
        <li>Enter your Apple ID and press Start.</li>
        <li>
          On the iPhone: Settings, General, VPN &amp; Device Management, trust your Apple ID. Then
          open Archova.
        </li>
      </ol>
    </div>
  );
}
