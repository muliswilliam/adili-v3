import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons';
import { type ComponentProps, type ReactNode, useEffect, useId, useRef, useState } from 'react';

import { cn } from '../lib/cn';
import { formatTime } from '../lib/format-date';
import { formatNumber } from '../lib/format-number';
import type { AutosaveState } from '../lib/use-autosave';
import { Button } from './button';
import { Icon } from './icon';
import { SaveIndicator } from './save-indicator';
import { Textarea } from './textarea';

/**
 * What the editor needs of a paragraph. The reporting contract's `NarrativeParagraph` has these
 * and more (`aggregateRefs`, `candidateIds`); pass it as is and the editor keeps the rest.
 * `aiDraft` is true for an AI-drafted paragraph until it is edited.
 */
export interface NarrativeEditorParagraph {
  id: string;
  text: string;
  aiDraft?: boolean;
}

/** Paragraphs per section id, in order. A missing section has none. */
export type NarrativeValue<P extends NarrativeEditorParagraph = NarrativeEditorParagraph> = Record<
  string,
  P[]
>;

/** How the contract stores a section: its paragraphs' text, separated by a blank line. */
export const NARRATIVE_PARAGRAPH_SEPARATOR = '\n\n';

/** Every section's stored text, the body `PATCH .../narrative` takes. */
export function narrativeSections(value: NarrativeValue): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).map(([section, paragraphs]) => [
      section,
      narrativeSectionText(paragraphs),
    ]),
  );
}

/**
 * A section's text as the contract stores it (non-empty paragraphs joined by a blank line), the
 * text its `maxLength` applies to.
 */
export function narrativeSectionText(paragraphs: readonly NarrativeEditorParagraph[]): string {
  return paragraphs
    .map((paragraph) => paragraph.text.trim())
    .filter(Boolean)
    .join(NARRATIVE_PARAGRAPH_SEPARATOR);
}

export interface NarrativeSection {
  id: string;
  /** "Overview": names the section and its fields. */
  label: string;
  /** The most characters the section's stored text may hold, as the contract limits it. */
  maxLength?: number;
}

export interface NarrativeEditorMessages {
  autosaves: string;
  saving: string;
  /** The time of the last save in Kenyan time → "Saved 10:42". */
  saved: (time: string) => string;
  retrying: string;
  /** The save was refused for good, e.g. "Approved: no longer editable". */
  error: string;
  conflict: string;
  /** Names a paragraph's field: "Overview, paragraph 2". */
  paragraph: (section: string, position: number) => string;
  /** The placeholder of a section's first paragraph: "Write the overview…". */
  firstPlaceholder: (section: string) => string;
  placeholder: string;
  addParagraph: string;
  /** Names the add button: "Add paragraph to overview". */
  addParagraphTo: (section: string) => string;
  /** Names a remove button: "Remove overview paragraph 2". */
  removeParagraph: (section: string, position: number) => string;
  characters: (count: string) => string;
  /** A section over its limit: "21,000 characters, 20,000 at most". */
  tooLong: (count: string, max: string) => string;
  /** A read-only section with nothing written. */
  notWritten: string;
}

export const NARRATIVE_EDITOR_MESSAGES: NarrativeEditorMessages = {
  autosaves: 'Autosaves',
  saving: 'Saving…',
  saved: (time) => `Saved ${time}`,
  retrying: 'Could not save, retrying',
  error: 'Could not save',
  conflict: 'Edited elsewhere: reload to continue',
  paragraph: (section, position) => `${section}, paragraph ${String(position)}`,
  firstPlaceholder: (section) => `Write the ${section.toLowerCase()}…`,
  placeholder: 'Write a paragraph…',
  addParagraph: 'Add paragraph',
  addParagraphTo: (section) => `Add paragraph to ${section.toLowerCase()}`,
  removeParagraph: (section, position) =>
    `Remove ${section.toLowerCase()} paragraph ${String(position)}`,
  characters: (count) => `${count} characters`,
  tooLong: (count, max) => `${count} characters, ${max} at most`,
  notWritten: 'Not written yet.',
};

export interface NarrativeChange {
  /**
   * Whether the text as stored (`narrativeSections`) changed. False for adding or removing an
   * empty paragraph, which a caller need not save.
   */
  textChanged: boolean;
}

/**
 * `createParagraph` makes the paragraph a section starts with and the ones "Add paragraph" adds.
 * It may be left out only when paragraphs are plain `{ id, text, aiDraft? }`; a richer type
 * (the contract's, with `aggregateRefs: []`) has to say how to make one.
 */
type CreateParagraphProp<P extends NarrativeEditorParagraph> = NarrativeEditorParagraph extends P
  ? { createParagraph?: (id: string, section: NarrativeSection) => P }
  : { createParagraph: (id: string, section: NarrativeSection) => P };

export type NarrativeEditorProps<P extends NarrativeEditorParagraph = NarrativeEditorParagraph> =
  Omit<ComponentProps<'section'>, 'children' | 'onChange'> &
    CreateParagraphProp<P> & {
      sections: NarrativeSection[];
      value: NarrativeValue<P>;
      /**
       * Every edit, with the whole narrative. Required unless read-only. Save it through the
       * `useAutosave` passed as `autosave`, e.g. `autosave.change(narrativeSections(next))`
       * when `change.textChanged`.
       */
      onChange?: (value: NarrativeValue<P>, change: NarrativeChange) => void;
      /**
       * The `useAutosave` saving this narrative: the header shows its status and the fields flush
       * it when they lose focus. Without it nothing about saving is shown.
       */
      autosave?: AutosaveState;
      /** Shows the text without fields, e.g. to the supervisor or once approved. */
      readOnly?: boolean;
      /** Said in the header when read-only, e.g. "Written by the analyst" or "Frozen at approval". */
      readOnlyNote?: ReactNode;
      /** The card's heading. "Narrative" by default. */
      title?: ReactNode;
      /** In the header after the save status, e.g. a draft menu. */
      actions?: ReactNode;
      /** Above the sections, e.g. an alert that drafting failed. */
      notice?: ReactNode;
      /** Under a paragraph, e.g. its AI label and figure citations. */
      paragraphMeta?: (paragraph: P, section: NarrativeSection) => ReactNode;
      messages?: Partial<NarrativeEditorMessages>;
    };

/**
 * A report's narrative as a card of sections (Overview, Findings, Recommendations), each a list of
 * paragraphs the author writes, adds and removes. A blank line typed or pasted into a paragraph
 * splits it, as the contract stores paragraphs separated by blank lines. The header says how the
 * `autosave` stands ("Autosaves", "Saving…", "Saved 10:42"). An AI-drafted
 * paragraph is ringed in violet until edited, when it stops being an AI draft; its label comes
 * from `paragraphMeta`. Read-only, it shows the text and a note instead.
 */
export function NarrativeEditor<P extends NarrativeEditorParagraph = NarrativeEditorParagraph>({
  sections,
  value,
  onChange,
  autosave,
  readOnly = false,
  readOnlyNote,
  title = 'Narrative',
  actions,
  notice,
  paragraphMeta,
  createParagraph,
  messages,
  className,
  ...props
}: NarrativeEditorProps<P>) {
  const copy = { ...NARRATIVE_EDITOR_MESSAGES, ...messages };
  const headingId = useId();
  const root = useRef<HTMLElement>(null);
  // `CreateParagraphProp` allows leaving it out only when P is the plain paragraph.
  const makeParagraph =
    createParagraph ?? ((id: string) => ({ id, text: '' }) as NarrativeEditorParagraph as P);

  // An empty section shows one field; typing in it creates the paragraph under this id, so the
  // field keeps its focus. Only an empty section shows it, so it never clashes with a paragraph.
  const [startIds, setStartIds] = useState<Record<string, string>>(() =>
    Object.fromEntries(sections.map((section) => [section.id, crypto.randomUUID()])),
  );
  // Sections added later get theirs on the next render (state adjusted while rendering).
  const missing = sections.filter((section) => !(section.id in startIds));
  if (missing.length > 0) {
    setStartIds((current) => ({
      ...current,
      ...Object.fromEntries(missing.map((section) => [section.id, crypto.randomUUID()])),
    }));
  }
  const startId = (section: string) => startIds[section] ?? `${headingId}-${section}`;

  const focusNext = useRef<string | null>(null);
  useEffect(() => {
    const id = focusNext.current;
    if (!id) return;
    focusNext.current = null;
    root.current
      ?.querySelector<HTMLTextAreaElement>(`textarea[data-paragraph-id="${CSS.escape(id)}"]`)
      ?.focus();
  });

  const update = (section: string, paragraphs: P[]) => {
    const next = { ...value, [section]: paragraphs };
    const textChanged =
      narrativeSectionText(value[section] ?? []) !== narrativeSectionText(paragraphs);
    onChange?.(next, { textChanged });
  };

  return (
    <section
      aria-labelledby={headingId}
      className={cn('rounded-2xl bg-card text-card-foreground shadow-card', className)}
      ref={root}
      {...props}
    >
      <div className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
        <h3 id={headingId} className="text-[15.5px] font-semibold tracking-[-0.01em]">
          {title}
        </h3>
        <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
          {readOnly ? (
            readOnlyNote ? (
              <span className="text-[13px] text-muted-foreground">{readOnlyNote}</span>
            ) : null
          ) : autosave ? (
            <AutosaveText autosave={autosave} copy={copy} />
          ) : null}
          {actions}
        </div>
      </div>
      <div className="flex flex-col gap-6 px-5 py-[18px]">
        {notice}
        {sections.map((section) => {
          const paragraphs = value[section.id] ?? [];
          const length = narrativeSectionText(paragraphs).length;
          const tooLong = section.maxLength !== undefined && length > section.maxLength;
          const labelId = `${headingId}-${section.id}`;
          const countId = `${labelId}-count`;
          const shown: P[] =
            readOnly || paragraphs.length > 0
              ? paragraphs
              : [makeParagraph(startId(section.id), section)];
          const written = paragraphs.filter((paragraph) => paragraph.text.trim() !== '');

          return (
            <div
              key={section.id}
              role="group"
              aria-labelledby={labelId}
              className="flex flex-col gap-1.5"
            >
              <div className="flex items-baseline gap-2.5">
                <h4 id={labelId} className="text-[14.5px] font-semibold">
                  {section.label}
                </h4>
                {readOnly ? null : (
                  <span
                    id={countId}
                    className={cn(
                      'ml-auto text-xs text-muted-foreground tabular-nums',
                      tooLong && 'font-medium text-destructive',
                    )}
                  >
                    {tooLong && section.maxLength !== undefined
                      ? copy.tooLong(formatNumber(length), formatNumber(section.maxLength))
                      : copy.characters(formatNumber(length))}
                  </span>
                )}
              </div>
              {readOnly ? (
                <div className="flex flex-col gap-3">
                  {written.length > 0 ? (
                    written.map((paragraph) => (
                      <div key={paragraph.id}>
                        <p
                          className={cn(
                            'rounded-[10px] bg-card px-3.5 py-3 text-[14.5px] leading-[1.6] whitespace-pre-wrap shadow-card-flat',
                            paragraph.aiDraft && 'shadow-control-ai',
                          )}
                        >
                          {paragraph.text}
                        </p>
                        <Meta>{paragraphMeta?.(paragraph, section)}</Meta>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-[10px] px-3.5 py-3 text-[14.5px] text-muted-foreground shadow-card-flat">
                      {copy.notWritten}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {shown.map((paragraph, index) => {
                    const removable =
                      paragraphs.length > 1 || (paragraphs.length === 1 && paragraph.text !== '');
                    return (
                      <div key={paragraph.id} className="group relative">
                        <Textarea
                          autoGrow
                          rows={2}
                          data-paragraph-id={paragraph.id}
                          data-ai-draft={paragraph.aiDraft ? 'true' : undefined}
                          aria-label={copy.paragraph(section.label, index + 1)}
                          aria-invalid={tooLong || undefined}
                          aria-describedby={tooLong ? countId : undefined}
                          placeholder={
                            index === 0 ? copy.firstPlaceholder(section.label) : copy.placeholder
                          }
                          value={paragraph.text}
                          className={cn(
                            'min-h-[72px] pr-11 text-[14.5px] leading-[1.6]',
                            paragraph.aiDraft && 'shadow-control-ai hover:shadow-control-ai',
                          )}
                          onChange={(event) => {
                            // A blank line ends the paragraph: what follows becomes the next
                            // ones, as the contract would split it on save anyway.
                            const [first = '', ...more] = event.target.value.split(BLANK_LINE);
                            const edited: P = {
                              ...paragraph,
                              text: first,
                              ...(paragraph.aiDraft ? { aiDraft: false } : {}),
                            };
                            const split = more.map((text) => ({
                              ...makeParagraph(crypto.randomUUID(), section),
                              text,
                            }));
                            const last = split.at(-1);
                            if (last) focusNext.current = last.id;
                            const current = paragraphs.length === 0 ? [paragraph] : paragraphs;
                            update(
                              section.id,
                              current.flatMap((each) =>
                                each.id === paragraph.id ? [edited, ...split] : [each],
                              ),
                            );
                          }}
                          onBlur={autosave?.flush}
                        />
                        {removable ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={copy.removeParagraph(section.label, index + 1)}
                            className="absolute top-1.5 right-1.5 size-[30px] text-muted-foreground opacity-70 group-hover:opacity-100 focus-visible:opacity-100 [&_svg]:size-[15px]"
                            onClick={() => {
                              const rest = paragraphs.filter((each) => each.id !== paragraph.id);
                              focusNext.current =
                                rest[Math.max(index - 1, 0)]?.id ?? startId(section.id);
                              update(section.id, rest);
                            }}
                          >
                            <Icon icon={Delete02Icon} />
                          </Button>
                        ) : null}
                        <Meta>{paragraphMeta?.(paragraph, section)}</Meta>
                      </div>
                    );
                  })}
                  <div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={copy.addParagraphTo(section.label)}
                      onClick={() => {
                        const added = makeParagraph(crypto.randomUUID(), section);
                        focusNext.current = added.id;
                        update(section.id, [...paragraphs, added]);
                      }}
                    >
                      <Icon icon={Add01Icon} />
                      {copy.addParagraph}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A blank line, possibly holding spaces, as the contract separates paragraphs. */
const BLANK_LINE = /\n[ \t]*\n\s*/;

function Meta({ children }: { children: ReactNode }) {
  if (children === null || children === undefined || children === false) return null;
  return <div className="mt-[7px] flex min-h-6 flex-wrap items-center gap-1.5">{children}</div>;
}

function AutosaveText({
  autosave: { status, savedAt },
  copy,
}: {
  autosave: AutosaveState;
  copy: NarrativeEditorMessages;
}) {
  // One live region from the start, so the first "Saving…" is read out.
  return (
    <SaveIndicator
      status={status}
      messages={{
        idle: copy.autosaves,
        saving: copy.saving,
        retrying: copy.retrying,
        error: copy.error,
        conflict: copy.conflict,
        saved: savedAt ? copy.saved(formatTime(savedAt.getTime())) : copy.saving,
      }}
    />
  );
}
