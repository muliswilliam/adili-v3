import { cn, QrCode } from '@adili/ui';

import type { DraftLanguage } from '../../../clarification/draft-selection';
import { LETTER_REQUIREMENT_LABELS } from '../../../clarification/labels';
import type { CaseListItem, Requirement } from '../../../server/review/types';
import { letterCopy, messages as t } from './messages';

/**
 * The clarification letter as the declarant will read it (spec 07a FE-4): the Commission's
 * letterhead, the references, the items with what s.35(4) requires, the due date and how to
 * respond. A preview of what `clarification-letter.v1` renders from the review service's letter
 * payload, so it uses the same item labels and requirement words, in the letter's language; the
 * issued PDF is the record. The reviewer's text is shown as written.
 */

/** The Commission the letter comes from, as the directory has it. */
export interface LetterCommission {
  name: string;
  /** e.g. `TSC`, the issuer code in its references. */
  issuerCode: string;
}

export interface LetterItem {
  /** As the letter prints it, in its language (`letterLabelOf`). */
  label: string | null;
  requirement: Requirement | null;
  text: string;
}

export interface LetterPreviewProps {
  commission: LetterCommission;
  reviewCase: Pick<CaseListItem, 'reference' | 'declarantName' | 'personnelFileNumber' | 'type'>;
  /** The declarant's reporting entity, from the declaration as filed (`reportingEntityOf`). */
  reportingEntity: string | null;
  items: readonly LetterItem[];
  /** The letter's language (review.yaml `LetterLanguage`): its own text is in it. */
  language: DraftLanguage;
  /** Draft with AI's opening paragraph, when there is one. */
  opening?: string | null;
  /**
   * Some of the text (the opening or an item) was drafted with AI: the letter says so, as the
   * issued one does (`ClarificationLetterPayload.aiAssisted`, ADR-007).
   */
  aiAssisted?: boolean;
  /** Set once issued; until then the preview says when they are allocated. */
  reference?: string | null;
  verificationId?: string | null;
  /** Issue date, or today for a preview. */
  date: string;
  dueAt: string;
  revoked?: boolean;
  className?: string;
}

export function LetterPreview({
  commission,
  reviewCase,
  reportingEntity,
  items,
  language,
  opening,
  aiAssisted = false,
  reference,
  verificationId,
  date,
  dueAt,
  revoked = false,
  className,
}: LetterPreviewProps) {
  const year = new Date(date).getUTCFullYear();
  const letter = letterCopy[language];
  const requirements = LETTER_REQUIREMENT_LABELS[language];
  return (
    <article
      aria-label={t.letterPreviewLabel}
      lang={language}
      className={cn(
        'relative rounded-md bg-paper px-5 py-6 sm:px-[30px] sm:py-7 font-serif text-[13.5px] leading-[1.6] text-paper-foreground shadow-paper',
        className,
      )}
    >
      <header className="mb-3.5 flex items-center gap-3 border-b-2 border-paper-foreground pb-3 font-sans">
        <span
          aria-hidden="true"
          className="grid size-[38px] shrink-0 place-items-center rounded-full bg-seal text-[11px] font-bold text-seal-foreground"
        >
          {commission.issuerCode}
        </span>
        <span className="min-w-0 text-sm font-bold">{commission.name}</span>
        <span className="ml-auto rounded-sm border-[1.5px] border-destructive px-2 py-0.5 text-[11px] font-bold tracking-[0.12em] text-destructive uppercase">
          {letter.restricted}
        </span>
      </header>
      <dl className="mb-3.5 grid grid-cols-[auto_1fr] gap-x-3.5 gap-y-0.5 font-sans text-[12.5px]">
        <dt className="text-muted-foreground">{letter.ref}</dt>
        <dd className="font-mono">{reference ?? letter.refPending(commission.issuerCode, year)}</dd>
        <dt className="text-muted-foreground">{letter.date}</dt>
        <dd>{letter.formatDate(date)}</dd>
        <dt className="text-muted-foreground">{letter.re}</dt>
        <dd className="font-mono">{reviewCase.reference}</dd>
      </dl>
      <p>
        {reviewCase.declarantName}
        <br />
        {letter.fileNumber(reviewCase.personnelFileNumber)}
        {reportingEntity ? (
          <>
            <br />
            {reportingEntity}
          </>
        ) : null}
      </p>
      <h4 className="mt-3 mb-2 font-sans text-sm font-bold">{letter.heading}</h4>
      {opening ? <p className="mb-2 whitespace-pre-line">{opening}</p> : null}
      <p>{letter.intro(reviewCase.type)}</p>
      <ol className="my-2 list-decimal pl-5">
        {items.length > 0 ? (
          items.map((item, index) => (
            <li key={index} className="mb-2">
              {item.label ? <b>{item.label}</b> : <b lang="en">{t.letterNoTarget}</b>}
              <br />
              {item.requirement ? (
                <i>{requirements[item.requirement]}.</i>
              ) : (
                <i lang="en">{t.letterNoRequirement}.</i>
              )}{' '}
              <span className="whitespace-pre-line">{item.text}</span>
            </li>
          ))
        ) : (
          <li lang="en" className="text-muted-foreground">
            {t.letterEmpty}
          </li>
        )}
      </ol>
      <p>{letter.respond(dueAt)}</p>
      <p className="mt-3.5">{letter.signOff}</p>
      {aiAssisted ? (
        <p className="mt-2 font-sans text-[11.5px] italic">{letter.aiAssisted}</p>
      ) : null}
      <footer className="mt-[18px] flex items-center gap-3.5 border-t pt-3 font-sans text-[11.5px] text-muted-foreground">
        {verificationId ? (
          <QrCode
            value={verificationId}
            label={letter.qrLabel(verificationId)}
            size={64}
            className="shrink-0"
          />
        ) : (
          <span
            aria-hidden="true"
            className="size-16 shrink-0 rounded-sm border border-dashed border-input bg-muted"
          />
        )}
        <p>
          {verificationId ? (
            <>
              {letter.verificationCode}{' '}
              <b className="font-mono text-foreground">{verificationId}</b>
              <br />
              {letter.verifyHow}
            </>
          ) : (
            letter.verifyPending
          )}
        </p>
      </footer>
      {revoked ? (
        <span className="pointer-events-none absolute top-[42%] left-1/2 -translate-x-1/2 -translate-y-1/2 -rotate-[14deg] rounded-lg border-[3px] border-destructive/45 px-3.5 py-1.5 font-sans text-[22px] font-extrabold tracking-[0.08em] whitespace-nowrap text-destructive/55 uppercase">
          {letter.revoked}
        </span>
      ) : null}
    </article>
  );
}
