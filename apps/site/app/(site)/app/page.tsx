import type { Metadata } from 'next';
import { buttonClassName } from '@archova/ui';
import { ANDROID_TEST_APK_URL } from '../../../src/lib/app-download';

export const metadata: Metadata = {
  title: 'Get the app',
  description: 'Download the Archova Android test build for site crews.',
};

export default function GetTheApp() {
  return (
    <>
      <h1>Get the app</h1>
      <p className="hero__sub">
        Archova for the field: diary, defects, drawings, sign-in and induction, working offline.
      </p>
      <section className="section">
        <ul className="grid">
          <li className="card">
            <h2>Android test build</h2>
            <p className="notice">
              <strong>Test build.</strong> This is not an app-store release. It is signed for
              testing only, so Android will ask you to allow installs from your browser.
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
            <h2>iPhone and iPad</h2>
            <p>
              There is no iOS build yet. Until there is, open Archova in Safari and use Share, then
              Add to Home Screen.
            </p>
          </li>
        </ul>
      </section>
    </>
  );
}
