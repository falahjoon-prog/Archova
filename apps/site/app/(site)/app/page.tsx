import type { Metadata } from 'next';
import { AppDownloadCards } from '../../../src/components/AppDownloadCards';

export const metadata: Metadata = {
  title: 'Get the app',
  description: 'Download the Archova Android and iPhone test builds for site crews.',
};

export default function GetTheApp() {
  return (
    <>
      <h1>Get the app</h1>
      <p className="hero__sub">
        Archova for the field: diary, defects, drawings, sign-in and induction, working offline.
      </p>
      <section className="section">
        <AppDownloadCards />
      </section>
    </>
  );
}
