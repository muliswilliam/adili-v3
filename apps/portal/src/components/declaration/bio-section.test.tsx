// @vitest-environment jsdom
import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { saveDeclarationSection } from '../../server/declarations';
import { BIO_MESSAGES } from '../../declaration/bio';
import { BioSection, ROSTER_NOTE } from './bio-section';
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
    expect(screen.getByText(BIO_MESSAGES.birthDateFormat)).toBeTruthy();
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
      screen.getByRole('checkbox', { name: 'Marital status changed since last declaration' }),
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
