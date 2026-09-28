// @vitest-environment jsdom
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveDeclarationSection } from '../../server/declarations';
import { BIO_MESSAGES } from '../../declaration/bio';
import { BioSection, ROSTER_NOTE } from './bio-section';
import { ROSTER_HINT } from '../../declaration/roster-prefill';
import { DECLARATION_ID, renderWorkspace, sampleBio } from './testing';

vi.mock('@tanstack/react-router', async () => (await import('./testing-mocks')).routerMock());
vi.mock('../../server/declarations', async () => (await import('./testing-mocks')).serverMock());

const saveMock = vi.mocked(saveDeclarationSection);

function renderBio(contents: Record<string, unknown> = {}, showErrors = false) {
  return renderWorkspace(
    <BioSection section={sampleBio(contents)} etag={'"1"'} showErrors={showErrors} />,
    { step: 'bio' },
  );
}

const HR = {
  maritalStatus: 'married',
  employment: {
    designation: 'Deputy Principal',
    employer: 'Nyeri High School',
    responsibleCommission: 'tsc',
    personnelFileNumber: 'TSC/999999',
    jobGroup: 'D3 (T-Scale 13)',
    appointmentDate: '2026-09-02',
    workStation: 'Eldoret, Uasin Gishu',
  },
};

function renderHr(contents: Record<string, unknown>, { saved = false } = {}) {
  const section = sampleBio(contents);
  if (saved) section.completeness = 'incomplete';
  return renderWorkspace(<BioSection section={section} etag={'"1"'} />, { step: 'bio' });
}

function hinted(name: RegExp) {
  return screen.getByRole<HTMLInputElement>('textbox', { name, description: ROSTER_HINT });
}

function textbox(name: string) {
  return screen.getByRole<HTMLInputElement>('textbox', { name });
}

function rosterValue(term: string) {
  const block = screen.getByRole('region', { name: "From your Commission's roster" });
  const dt = within(block).getByText(term, { selector: 'dt' });
  return dt.nextElementSibling?.textContent;
}

beforeEach(() => {
  saveMock.mockReset();
  saveMock.mockReturnValue(new Promise(() => undefined));
});

describe('BioSection', () => {
  it('shows the roster block read-only with how to correct it', () => {
    renderBio();

    expect(screen.getByText(ROSTER_NOTE)).toBeTruthy();
    expect(rosterValue('Surname')).toBe('Kamau');
    expect(rosterValue('First name')).toBe('Mwangi');
    expect(rosterValue('Other names')).toBe('Njoroge');
    expect(rosterValue('Employer')).toBe('Nyeri High School');
    expect(rosterValue('Designation')).toBe('Deputy Principal');
    expect(rosterValue('Responsible Commission')).toBe('Teachers Service Commission');
    expect(screen.queryByRole('textbox', { name: 'Surname' })).toBeNull();
  });

  it('starts without errors on a fresh draft', () => {
    renderBio();

    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect(textbox('Place of birth').getAttribute('aria-invalid')).toBeNull();
  });

  it('rejects an impossible date while typing', () => {
    renderBio();

    fireEvent.change(textbox('Date of birth'), { target: { value: '31/02/1977' } });

    expect(textbox('Date of birth').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(BIO_MESSAGES.dateFormat)).toBeTruthy();
  });

  it('shows a missing answer once the field is left', () => {
    renderBio();

    fireEvent.blur(textbox('Place of birth'));

    expect(screen.getByText(BIO_MESSAGES.birthPlace)).toBeTruthy();
    expect(screen.queryByText(BIO_MESSAGES.postal)).toBeNull();
  });

  it('shows every missing answer when asked and focuses the first', () => {
    renderBio({}, true);

    for (const message of [
      BIO_MESSAGES.birthDate,
      BIO_MESSAGES.birthPlace,
      BIO_MESSAGES.maritalStatus,
      BIO_MESSAGES.postal,
      BIO_MESSAGES.physical,
      BIO_MESSAGES.nature,
    ]) {
      expect(screen.getByText(message)).toBeTruthy();
    }
    expect(document.activeElement).toBe(textbox('Date of birth'));
  });

  it('asks for an explanation when marital status changed', () => {
    renderBio({ maritalStatus: 'married' }, true);

    expect(screen.queryByRole('textbox', { name: 'Explain the change' })).toBeNull();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'My marital status changed since my last declaration' }),
    );

    expect(textbox('Explain the change')).toBeTruthy();
    expect(screen.getByText(BIO_MESSAGES.maritalChange)).toBeTruthy();
  });

  it('shows a complete bio with the marital change explained and no errors', () => {
    renderBio(
      {
        birth: { date: '1980-04-02', place: 'Nyeri' },
        maritalStatus: 'married',
        maritalStatusChange: { changed: true, explanation: 'Married in April 2025.' },
        address: { postal: 'P.O. Box 12-10100, Nyeri', physical: 'Ruringu estate, Nyeri' },
        employment: {
          designation: 'Deputy Principal',
          employer: 'Nyeri High School',
          responsibleCommission: 'tsc',
          personnelFileNumber: 'TSC/999999',
          nature: 'permanent',
        },
      },
      true,
    );

    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect(textbox('Date of birth').value).toBe('02/04/1980');
    expect(screen.getByRole<HTMLInputElement>('radio', { name: 'Married' }).checked).toBe(true);
    expect(textbox('Explain the change').value).toBe('Married in April 2025.');
  });

  it('autosaves the whole officer section, keeping the locked roster fields', async () => {
    vi.useFakeTimers();
    try {
      renderBio();

      fireEvent.change(textbox('Place of birth'), { target: { value: 'Nyeri' } });
      fireEvent.click(screen.getByRole('radio', { name: 'Single' }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_500);
      });

      expect(saveMock).toHaveBeenCalledTimes(1);
      expect(saveMock).toHaveBeenCalledWith({
        data: {
          declarationId: DECLARATION_ID,
          sectionKey: 'bio',
          ifMatch: '"1"',
          contents: expect.objectContaining({
            name: { surname: 'Kamau', firstName: 'Mwangi', otherNames: 'Njoroge' },
            birth: { place: 'Nyeri' },
            maritalStatus: 'single',
          }) as unknown,
        },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('S8: pre-fills the HR fields from the roster, editable, with where they came from', () => {
    renderHr(HR);

    expect(hinted(/^Job group/).value).toBe('D3 (T-Scale 13)');
    expect(hinted(/^Date of appointment/).value).toBe('02/09/2026');
    expect(hinted(/^Work station/).value).toBe('Eldoret, Uasin Gishu');
    const marital = screen.getByRole('group', { name: 'Marital status' });
    expect(within(marital).getByText(ROSTER_HINT)).toBeTruthy();
    expect(within(marital).getByRole<HTMLInputElement>('radio', { name: 'Married' }).checked).toBe(
      true,
    );
  });

  it('S8: drops the roster note once the declarant changes a value, and saves it', () => {
    vi.useFakeTimers();
    try {
      renderHr(HR);

      fireEvent.change(hinted(/^Job group/), { target: { value: 'D4 (T-Scale 14)' } });

      const jobGroup = screen.getByRole<HTMLInputElement>('textbox', { name: /^Job group/ });
      expect(jobGroup.value).toBe('D4 (T-Scale 14)');
      expect(jobGroup.getAttribute('aria-describedby')).toBeNull();
      expect(hinted(/^Work station/)).toBeTruthy();
      act(() => {
        vi.advanceTimersByTime(1_500);
      });
      expect(saveMock).toHaveBeenCalledWith({
        data: expect.objectContaining({
          contents: expect.objectContaining({
            employment: expect.objectContaining({
              jobGroup: 'D4 (T-Scale 14)',
              workStation: 'Eldoret, Uasin Gishu',
              designation: 'Deputy Principal',
            }) as unknown,
          }) as unknown,
        }) as unknown,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('S8: leaves the HR fields empty and editable when the roster has none', () => {
    renderHr({});

    for (const name of [/^Job group/, /^Date of appointment/, /^Work station/]) {
      const field = screen.getByRole<HTMLInputElement>('textbox', { name });
      expect(field.value).toBe('');
      expect(field.disabled).toBe(false);
    }
    expect(screen.queryByText(ROSTER_HINT, { selector: 'span' })).toBeNull();
  });

  it('claims nothing came from the roster for a saved bio it has no record of', () => {
    renderHr(HR, { saved: true });

    expect(screen.getByRole<HTMLInputElement>('textbox', { name: /^Job group/ }).value).toBe(
      'D3 (T-Scale 13)',
    );
    expect(screen.queryByText(ROSTER_HINT, { selector: 'span' })).toBeNull();
  });

  it('sends waiting edits at once when the declarant leaves the screen', async () => {
    const { unmount } = renderBio();

    fireEvent.change(textbox('Place of birth'), { target: { value: 'Nyeri' } });
    expect(saveMock).not.toHaveBeenCalled();
    await act(async () => {
      unmount();
      await Promise.resolve();
    });

    expect(saveMock).toHaveBeenCalledTimes(1);
  });
});
