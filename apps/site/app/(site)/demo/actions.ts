'use server';

import { cms } from '../../../src/lib/cms';
import { readInquiry, validateInquiry, type InquiryErrors } from '../../../src/lib/inquiry';

export interface DemoState {
  status: 'idle' | 'error' | 'sent';
  errors?: InquiryErrors;
  values?: Record<string, string>;
}

export async function requestDemo(_prev: DemoState, form: FormData): Promise<DemoState> {
  const input = readInquiry(form);
  // Bots fill the hidden field. Pretend it worked and store nothing.
  if (input.website) return { status: 'sent' };
  const errors = validateInquiry(input);
  if (Object.keys(errors).length > 0) {
    return { status: 'error', errors, values: { ...input, consent: input.consent ? 'on' : '' } };
  }
  const payload = await cms();
  await payload.create({
    collection: 'inquiries',
    overrideAccess: true,
    data: {
      name: input.name,
      email: input.email,
      company: input.company,
      phone: input.phone,
      teamSize: input.teamSize,
      message: input.message,
      consentGiven: true,
    },
  });
  return { status: 'sent' };
}
