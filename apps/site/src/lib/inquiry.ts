// Pure validation for the demo request form, so it can be unit tested without the CMS.
export interface InquiryInput {
  name: string;
  email: string;
  company: string;
  phone: string;
  teamSize: string;
  message: string;
  consent: boolean;
  /** Honeypot: real people never fill this in. */
  website: string;
}

export type InquiryErrors = Partial<Record<'name' | 'email' | 'consent', string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function readInquiry(form: FormData): InquiryInput {
  const s = (k: string) => String(form.get(k) ?? '').trim();
  return {
    name: s('name').slice(0, 120),
    email: s('email').slice(0, 200),
    company: s('company').slice(0, 160),
    phone: s('phone').slice(0, 40),
    teamSize: s('teamSize').slice(0, 40),
    message: s('message').slice(0, 2000),
    consent: form.get('consent') === 'on',
    website: s('website'),
  };
}

export function validateInquiry(i: InquiryInput): InquiryErrors {
  const errors: InquiryErrors = {};
  if (!i.name) errors.name = 'Enter your name.';
  if (!EMAIL.test(i.email)) errors.email = 'Enter a valid email address.';
  if (!i.consent) errors.consent = 'Please agree to us contacting you.';
  return errors;
}
