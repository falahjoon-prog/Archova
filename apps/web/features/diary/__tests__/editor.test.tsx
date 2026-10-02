// @vitest-environment jsdom
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { renderInProject } from '@/test/render';
import { DiaryEditor } from '../components/DiaryEditor';
import { emptyContent } from '../data/source';
import type { DiaryContent } from '../lib/types';

function Editor({ initial }: { initial: DiaryContent }) {
  const [value, setValue] = useState(initial);
  return <DiaryEditor value={value} onChange={setValue} weather={null} photosToday={[]} />;
}

describe('DiaryEditor sign-in labour (ATT-AC6)', () => {
  it('shows the sign-in numbers and asks for a reason once they are changed', async () => {
    const user = userEvent.setup();
    renderInProject(
      <Editor
        initial={{
          ...emptyContent(),
          labour: [
            {
              id: 'dlb_1',
              companyId: 'cmp_elec',
              trade: '',
              headcount: 4,
              hours: 32,
              signIn: { headcount: 4, hours: 32 },
              editReason: '',
            },
          ],
        }}
      />,
    );
    expect(screen.getByText('Site sign-in: 4 people · 32 hours')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.queryByLabelText(/numbers differ from site sign-in/)).toBeNull();

    const headcount = screen.getByLabelText('Brightwire Electrical headcount');
    await user.clear(headcount);
    await user.type(headcount, '3');
    const reason = screen.getByLabelText(
      "Why do Brightwire Electrical's numbers differ from site sign-in?",
    );
    expect(screen.getByText('Add a reason, or put the sign-in numbers back.')).toBeTruthy();
    await user.type(reason, 'Apprentice left at lunch');
    expect(screen.queryByText('Add a reason, or put the sign-in numbers back.')).toBeNull();
  });
});
