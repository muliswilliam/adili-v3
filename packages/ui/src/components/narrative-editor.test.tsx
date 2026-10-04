import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { parse } from 'yaml';

import type { Assert } from '../lib/type-checks';
import { AutosaveFailure, useAutosave } from '../lib/use-autosave';
import {
  type MatchesNarrativeSections,
  NARRATIVE_MAX_LENGTH,
  NATIONAL_REPORT_NARRATIVE_SECTIONS,
  NarrativeEditor,
  narrativeSections,
  narrativeSectionText,
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
  onSave?: (value: NarrativeValue) => Promise<void>;
  spy?: (value: NarrativeValue) => void;
}) {
  const [value, setValue] = useState(initial);
  const autosave = useAutosave(onSave, { delayMs: 1_000 });
  return (
    <NarrativeEditor
      sections={SECTIONS}
      value={value}
      autosave={autosave}
      onChange={(next, change) => {
        spy?.(next);
        setValue(next);
        if (change.textChanged) autosave.change(next);
      }}
      {...props}
    />
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('narrativeSectionText', () => {
  it('joins the written paragraphs with a blank line, as the contract stores a section', () => {
    expect(
      narrativeSectionText([
        { id: 'a', text: ' First. ' },
        { id: 'b', text: '' },
        { id: 'c', text: '   ' },
        { id: 'd', text: 'Second.' },
      ]),
    ).toBe('First.\n\nSecond.');
  });

  it('is empty for no paragraphs', () => {
    expect(narrativeSectionText([])).toBe('');
  });
});

describe('the national report narrative table', () => {
  it('has the contract’s sections and limits', () => {
    const contract = parse(
      readFileSync(
        createRequire(import.meta.url).resolve('@adili/schemas/internal/reporting.yaml'),
        'utf8',
      ),
    ) as {
      components: {
        schemas: {
          Narrative: { required: string[]; properties: Record<string, { maxLength: number }> };
        };
      };
    };
    const narrative = contract.components.schemas.Narrative;

    expect(NATIONAL_REPORT_NARRATIVE_SECTIONS.map((section) => section.id)).toEqual(
      narrative.required,
    );
    expect(NARRATIVE_MAX_LENGTH).toEqual(
      Object.fromEntries(
        Object.entries(narrative.properties).map(([id, { maxLength }]) => [id, maxLength]),
      ),
    );
  });

  it('matches a Narrative type with the same sections, and only that', () => {
    interface Narrative {
      overview: string;
      findings: string;
      recommendations: string;
    }
    type Checked = Assert<MatchesNarrativeSections<Narrative>>;
    // @ts-expect-error a section missing from the table fails to compile
    type Drifted = Assert<MatchesNarrativeSections<Narrative & { annex: string }>>;
    const body: Narrative = narrativeSections({}, NATIONAL_REPORT_NARRATIVE_SECTIONS);

    expect(body).toEqual({ overview: '', findings: '', recommendations: '' });
    expect<[Checked?, Drifted?]>([]).toEqual([]);
  });
});

describe('narrativeSections', () => {
  it('gives every section, empty or missing ones as empty text', () => {
    expect(
      narrativeSections(
        { overview: [{ id: 'a', text: 'Overview.' }], findings: [] },
        NATIONAL_REPORT_NARRATIVE_SECTIONS,
      ),
    ).toEqual({ overview: 'Overview.', findings: '', recommendations: '' });
  });

  it('leaves out what is not a section', () => {
    expect(narrativeSections({ stray: [{ id: 'x', text: 'x' }] }, [{ id: 'overview' }])).toEqual({
      overview: '',
    });
  });
});

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

  it('says a refused save in its own words, and stops retrying', async () => {
    const onSave = vi.fn(() => Promise.reject(new AutosaveFailure('error', 'ncr-approved')));
    render(<Editor onSave={onSave} messages={{ error: 'Approved: no longer editable' }} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Overview, paragraph 1' }), {
      target: { value: 'Changed.' },
    });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    await settle();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByRole('status').textContent).toBe('Approved: no longer editable');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('splits a paragraph at a blank line, as the contract stores paragraphs', () => {
    const spy = vi.fn();
    render(<Editor spy={spy} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' }), {
      target: { value: 'Follow up.\n\nPublish the names.\n \nAgree a plan.' },
    });

    const recommendations = (spy.mock.lastCall?.[0] as NarrativeValue).recommendations;
    expect(recommendations?.map((p) => p.text)).toEqual([
      'Follow up.',
      'Publish the names.',
      'Agree a plan.',
    ]);
    expect(recommendations?.[0]?.id).toBe('p3');
    expect(new Set(recommendations?.map((p) => p.id)).size).toBe(3);
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Recommendations, paragraph 3' }),
    );
  });

  it('starts a new paragraph when Enter is pressed twice', () => {
    render(<Editor />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' }), {
      target: { value: 'Follow up.\n\n' },
    });

    const added = screen.getByRole('textbox', { name: 'Recommendations, paragraph 2' });
    expect(added).toHaveProperty('value', '');
    expect(document.activeElement).toBe(added);
  });

  it('renders an empty section’s field the same on server and browser, keeping focus on typing', () => {
    const { container } = render(<Editor />);
    const field = screen.getByRole('textbox', { name: 'Findings, paragraph 1' });
    expect(field.dataset.paragraphId).not.toMatch(/^[0-9a-f]{8}-/);
    field.focus();

    fireEvent.change(field, { target: { value: 'One finding.' } });

    expect(container.contains(field)).toBe(true);
    expect(document.activeElement).toBe(field);
  });

  it('puts the caret at the end of the last paragraph a paste was split into', () => {
    render(<Editor />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' }), {
      target: { value: 'Follow up.\n\nPublish the names.' },
    });

    const last = screen.getByRole<HTMLTextAreaElement>('textbox', {
      name: 'Recommendations, paragraph 2',
    });
    expect(document.activeElement).toBe(last);
    expect(last.selectionStart).toBe('Publish the names.'.length);
  });

  it('gives an empty section’s first paragraph a UUID', () => {
    const spy = vi.fn();
    render(<Editor spy={spy} />);

    fireEvent.change(screen.getByRole('textbox', { name: 'Findings, paragraph 1' }), {
      target: { value: 'One finding.' },
    });

    expect((spy.mock.lastCall?.[0] as NarrativeValue).findings?.[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('shows nothing about saving without an autosave', () => {
    render(<NarrativeEditor sections={SECTIONS} value={VALUE} onChange={() => undefined} />);

    expect(screen.queryByRole('status')).toBeNull();
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

    // As stored: the two paragraphs joined by a blank line.
    expect(screen.getByText('60 characters')).toBeTruthy();
    const over = screen.getByText('21 characters, 20 at most');
    expect(over.className).toContain('text-destructive');
    expect(
      screen.getByRole('textbox', { name: 'Findings, paragraph 1' }).getAttribute('aria-invalid'),
    ).toBe('true');
  });

  it('keeps what else a paragraph carries, and makes new ones with the caller’s shape', () => {
    interface Cited {
      id: string;
      text: string;
      aiDraft?: boolean;
      aggregateRefs: string[];
    }
    const spy = vi.fn();
    function CitedEditor() {
      const [value, setValue] = useState<NarrativeValue<Cited>>({
        overview: [{ id: 'c1', text: 'Cited.', aiDraft: true, aggregateRefs: ['national.rate'] }],
      });
      return (
        <NarrativeEditor<Cited>
          sections={[{ id: 'overview', label: 'Overview' }]}
          value={value}
          onChange={(next) => {
            spy(next);
            setValue(next);
          }}
          createParagraph={(id) => ({ id, text: '', aggregateRefs: [] })}
          paragraphMeta={(paragraph) => <span>{paragraph.aggregateRefs.join(', ') || 'none'}</span>}
        />
      );
    }
    render(<CitedEditor />);
    // A paragraph type with more than the editor needs has to say how to make one.
    // @ts-expect-error createParagraph is required for Cited
    const withoutCreate = <NarrativeEditor<Cited> sections={[]} value={{}} />;
    expect(withoutCreate).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Overview, paragraph 1' }), {
      target: { value: 'Cited, edited.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add paragraph to overview' }));

    expect(screen.getByText('national.rate')).toBeTruthy();
    expect(screen.getByText('none')).toBeTruthy();
    expect((spy.mock.lastCall?.[0] as NarrativeValue<Cited>).overview?.[0]).toEqual({
      id: 'c1',
      text: 'Cited, edited.',
      aiDraft: false,
      aggregateRefs: ['national.rate'],
    });
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

  it('shows what a caller puts in place of a section’s paragraphs, e.g. while AI drafts it', () => {
    render(
      <Editor
        sectionBody={(section) =>
          section.id === 'overview' ? <p role="status">Drafting overview…</p> : null
        }
      />,
    );

    const overview = screen.getByRole('group', { name: 'Overview' });
    expect(within(overview).getByRole('status').textContent).toBe('Drafting overview…');
    expect(within(overview).queryByRole('textbox')).toBeNull();
    expect(within(overview).queryByRole('button', { name: /Add paragraph/ })).toBeNull();
    // The other sections are written as usual, and the count still shows.
    expect(within(overview).getByText('60 characters')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Recommendations, paragraph 1' })).toBeTruthy();
  });

  it('keeps the paragraphs from changing while busy, e.g. while AI drafts the narrative', () => {
    render(<Editor busy />);

    expect(screen.getByRole('region', { name: 'Narrative' }).getAttribute('aria-busy')).toBe(
      'true',
    );

    const field = screen.getByRole('textbox', { name: 'Overview, paragraph 1' });
    expect(field.hasAttribute('readonly')).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Add paragraph to overview' }).hasAttribute('disabled'),
    ).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Remove overview paragraph 1' }).hasAttribute('disabled'),
    ).toBe(true);
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
