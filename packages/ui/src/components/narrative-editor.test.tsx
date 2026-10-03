import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NarrativeEditor,
  type NarrativeEditorProps,
  type NarrativeSection,
  type NarrativeValue,
} from './narrative-editor';

const SECTIONS: NarrativeSection[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'findings', label: 'Findings', maxLength: 20 },
  { id: 'recommendations', label: 'Recommendations' },
];

const VALUE: NarrativeValue = {
  overview: [
    { id: 'p1', text: '41 of 47 Commissions reported.' },
    { id: 'p2', text: 'The national rate was 86.2%.', aiDraft: true },
  ],
  findings: [],
  recommendations: [{ id: 'p3', text: 'Follow up.' }],
};

function Editor({
  initial = VALUE,
  onSave = () => Promise.resolve(),
  spy,
  ...props
}: Partial<NarrativeEditorProps> & {
  initial?: NarrativeValue;
  spy?: (value: NarrativeValue) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <NarrativeEditor
      sections={SECTIONS}
      value={value}
      onChange={(next) => {
        spy?.(next);
        setValue(next);
      }}
      onSave={onSave}
      saveDelayMs={1_000}
      {...props}
    />
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('NarrativeEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: Date.parse('2026-10-03T07:42:00Z') }); // 10:42 in Nairobi
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the card and each section, with a field per paragraph labelled by section and place', () => {
    render(<Editor />);

    expect(screen.getByRole('heading', { name: 'Narrative' })).toBeTruthy();
    expect(screen.getByText('Overview')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Overview, paragraph 1' })).toHaveProperty(
      'value',
      '41 of 47 Commissions reported.',
    );
    expect(screen.getByRole('textbox', { name: 'Overview, paragraph 2' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' })).toBeTruthy();
  });

  it('gives an empty section one field to start writing in', () => {
    render(<Editor />);

    const field = screen.getByRole('textbox', { name: 'Findings, paragraph 1' });
    expect((field as HTMLTextAreaElement).value).toBe('');
    expect(field.getAttribute('placeholder')).toBe('Write the findings…');
  });

  it('says it autosaves before anything changes', () => {
    render(<Editor />);

    expect(screen.getByText('Autosaves')).toBeTruthy();
  });

  it('autosaves the whole narrative once typing pauses, then says when it saved', async () => {
    const onSave = vi.fn<(value: NarrativeValue) => Promise<void>>(() => Promise.resolve());
    render(<Editor onSave={onSave} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' }), {
      target: { value: 'Follow up with each Commission.' },
    });
    expect(screen.getByRole('status').textContent).toBe('Saving…');
    expect(onSave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await settle();

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0].recommendations).toEqual([
      { id: 'p3', text: 'Follow up with each Commission.' },
    ]);
    expect(onSave.mock.calls[0]?.[0].overview).toHaveLength(2);
    expect(screen.getByRole('status').textContent).toBe('Saved 10:42');
  });

  it('saves at once when the editor loses focus', async () => {
    const onSave = vi.fn<(value: NarrativeValue) => Promise<void>>(() => Promise.resolve());
    render(<Editor onSave={onSave} />);
    const field = screen.getByRole('textbox', { name: 'Overview, paragraph 1' });

    fireEvent.change(field, { target: { value: 'Changed.' } });
    fireEvent.blur(field);
    await settle();

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('says a failed save is being retried', async () => {
    const onSave = vi.fn(() => Promise.reject(new Error('offline')));
    render(<Editor onSave={onSave} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Overview, paragraph 1' }), {
      target: { value: 'Changed.' },
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await settle();

    expect(screen.getByRole('status').textContent).toBe('Could not save, retrying');
  });

  it('writing in an empty section creates its first paragraph', () => {
    const spy = vi.fn();
    render(<Editor spy={spy} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Findings, paragraph 1' }), {
      target: { value: 'One finding.' },
    });

    const findings = (spy.mock.lastCall?.[0] as NarrativeValue).findings;
    expect(findings).toHaveLength(1);
    expect(findings?.[0]?.text).toBe('One finding.');
    expect(findings?.[0]?.id).toBeTruthy();
  });

  it('an edited AI draft paragraph is no longer an AI draft', () => {
    const spy = vi.fn();
    render(<Editor spy={spy} />);
    const drafted = screen.getByRole('textbox', { name: 'Overview, paragraph 2' });
    expect(drafted.dataset.aiDraft).toBe('true');

    fireEvent.change(drafted, { target: { value: 'The national rate was 86%.' } });

    expect((spy.mock.lastCall?.[0] as NarrativeValue).overview?.[1]).toEqual({
      id: 'p2',
      text: 'The national rate was 86%.',
      aiDraft: false,
    });
    expect(
      screen.getByRole('textbox', { name: 'Overview, paragraph 2' }).dataset.aiDraft,
    ).toBeUndefined();
  });

  it('adds a paragraph to a section and puts the cursor in it', () => {
    render(<Editor />);

    fireEvent.click(screen.getByRole('button', { name: 'Add paragraph to overview' }));

    const added = screen.getByRole('textbox', { name: 'Overview, paragraph 3' });
    expect(document.activeElement).toBe(added);
    expect(added.getAttribute('placeholder')).toBe('Write a paragraph…');
  });

  it('does not save an added paragraph until something is written in it', async () => {
    const onSave = vi.fn<(value: NarrativeValue) => Promise<void>>(() => Promise.resolve());
    render(<Editor onSave={onSave} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add paragraph to overview' }));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    await settle();

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Autosaves')).toBeTruthy();
  });

  it('removes a paragraph and moves the cursor to the one before', () => {
    const spy = vi.fn();
    render(<Editor spy={spy} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove overview paragraph 2' }));

    expect((spy.mock.lastCall?.[0] as NarrativeValue).overview?.map((p) => p.id)).toEqual(['p1']);
    expect(screen.queryByRole('textbox', { name: 'Overview, paragraph 2' })).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Overview, paragraph 1' }),
    );
  });

  it('offers no removal for the empty field of an empty section', () => {
    render(<Editor />);

    expect(screen.queryByRole('button', { name: 'Remove findings paragraph 1' })).toBeNull();
  });

  it('counts each section’s characters and flags one over its limit', () => {
    render(
      <Editor initial={{ ...VALUE, findings: [{ id: 'f1', text: 'Twenty-one characters' }] }} />,
    );

    expect(screen.getByText('58 characters')).toBeTruthy();
    const over = screen.getByText('21 characters, 20 at most');
    expect(over.className).toContain('text-destructive');
    expect(
      screen.getByRole('textbox', { name: 'Findings, paragraph 1' }).getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('shows what a caller puts under each paragraph, e.g. its AI label and citations', () => {
    render(
      <Editor
        paragraphMeta={(paragraph) =>
          paragraph.aiDraft ? <span>AI draft {paragraph.id}</span> : null
        }
      />,
    );

    expect(screen.getByText('AI draft p2')).toBeTruthy();
  });

  it('takes actions for the header, e.g. a draft menu', () => {
    render(<Editor actions={<button type="button">Draft narrative</button>} />);

    expect(screen.getByRole('button', { name: 'Draft narrative' })).toBeTruthy();
  });

  it('reads as text when read-only, with no fields, no autosave and a note instead', () => {
    render(
      <NarrativeEditor
        sections={SECTIONS}
        value={VALUE}
        readOnly
        readOnlyNote="Written by the analyst"
      />,
    );

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('Autosaves')).toBeNull();
    expect(screen.getByText('Written by the analyst')).toBeTruthy();
    expect(screen.getByText('41 of 47 Commissions reported.')).toBeTruthy();
    expect(screen.getByText('Not written yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add paragraph/ })).toBeNull();
  });

  it('takes other wording', () => {
    render(
      <Editor
        title="Maelezo"
        messages={{ autosaves: 'Huhifadhi yenyewe', paragraph: (s, n) => `${s}, aya ${n}` }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Maelezo' })).toBeTruthy();
    expect(screen.getByText('Huhifadhi yenyewe')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Overview, aya 1' })).toBeTruthy();
  });
});
