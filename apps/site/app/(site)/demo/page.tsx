import type { Metadata } from 'next';
import { DemoForm } from './DemoForm';

export const metadata: Metadata = {
  title: 'Request a demo',
  description: 'See Archova with your own projects in mind.',
};

export default function DemoPage() {
  return (
    <div className="narrow">
      <h1>Request a demo</h1>
      <p>Tell us a little about your business and we will set up a walk-through.</p>
      <DemoForm />
    </div>
  );
}
