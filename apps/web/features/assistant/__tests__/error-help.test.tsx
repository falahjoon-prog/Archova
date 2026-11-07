// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@archova/api-client';
import { ErrorAlert } from '@/shared/layout/ErrorAlert';
import { ErrorHelpProvider } from '@/shared/providers/ErrorHelpProvider';

describe('ErrorAlert Nova help', () => {
  it('offers nothing outside an organisation', () => {
    render(<ErrorAlert error={new TypeError('x')} />);
    expect(screen.queryByRole('button', { name: /Ask Nova/ })).toBeNull();
  });

  it('hands the error to Nova when asked', () => {
    const onAskHelp = vi.fn();
    render(
      <ErrorHelpProvider onAskHelp={onAskHelp}>
        <ErrorAlert error={new ApiError(403, { title: 'Forbidden', status: 403 } as never)} />
      </ErrorHelpProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Ask Nova what to do' }));
    expect(onAskHelp).toHaveBeenCalledWith(expect.objectContaining({ status: 403 }));
  });
});
