import type { AnswerOutput } from './answer-declarant-question.js';
import type { OutputViolation, ViolationKind } from './task.js';

/**
 * The tagged-text grammar a streamed answer is written in (ADR-019). The provider port streams
 * text only, so a task that needs structure while streaming has the model write it inline:
 *
 *     <block>Plain-language paragraph. <cite ids="id1,id2"/> <link section="…" field="…"/></block>
 *     <followup>A question the declarant may ask next?</followup>
 *
 * or `<declined/>` alone when the passages do not answer the question. Each block has exactly one
 * `<cite>` naming one or more passage ids and at most one `<link>` (`field` optional). Tags are
 * chosen not to look like minimisation tokens (`[[PERSON_1]]`).
 *
 * `TaggedAnswerReader` reads the text as it streams: `push` returns the blocks' prose to show now,
 * without tags, with an identifier token or a tag cut by a chunk boundary held back until it is
 * whole; `end` reads the whole answer, or says what broke the grammar.
 */

type AnswerBlock = AnswerOutput['blocks'][number];

/**
 * The answer, or why the text is not one: kinds and block indexes, never what was written. A read
 * answer is checked against the output schema still (the reader takes any section key).
 */
export type ReadAnswer =
  { ok: true; answer: AnswerOutput } | { ok: false; problems: OutputViolation[] };

const TAG = /^<(\/?)([a-z]+)((?:\s+[a-z]+="[^"]*")*)\s*\/?>$/;
const ATTRIBUTE = /([a-z]+)="([^"]*)"/g;
/** A tag longer than this is not one: the `<` is read as text. */
const MAX_TAG_LENGTH = 1000;
/** What a minimisation token (`[[PERSON_1]]`) can look like before its last character arrives. */
const TOKEN_PREFIX = /^\[(?:\[(?:[A-Z][A-Z_]*\d*\]?)?)?$/;
const PARAGRAPH = '\n\n';

interface OpenBlock {
  text: string;
  cites: number;
  passageIds: string[];
  links: number;
  sectionLink: AnswerBlock['sectionLink'];
  /** Whether any of its prose has been streamed, and whitespace held until more follows. */
  streamed: boolean;
  heldSpace: string;
}

export class TaggedAnswerReader {
  private buffer = '';
  private open: OpenBlock | undefined;
  private followUp: string | undefined;
  private declined = false;
  private readonly blocks: AnswerBlock[] = [];
  private readonly followUps: string[] = [];
  private readonly problems: OutputViolation[] = [];
  private streamedBlocks = 0;

  /** Reads a chunk; returns the prose to stream now (possibly empty). */
  push(chunk: string): string {
    this.buffer += chunk;
    return this.consume(false);
  }

  /**
   * Reads what is left: the last prose to stream, and the answer. A `truncated` text (the output
   * limit cut it off) is not an answer, whatever it holds.
   */
  end(status: 'completed' | 'truncated'): { delta: string; answer: ReadAnswer } {
    const delta = this.consume(true);
    if (status === 'truncated')
      return { delta, answer: { ok: false, problems: [{ kind: 'truncated' }] } };
    if (this.open) {
      this.problem('unclosed-block', this.blocks.length);
      this.open = undefined;
    }
    if (this.followUp !== undefined) this.problem('unclosed-followup');
    if (this.declined && (this.blocks.length > 0 || this.followUps.length > 0)) {
      this.problem('declined-with-answer');
    }
    if (!this.declined && this.blocks.length === 0) this.problem('empty-answer');
    const answer: ReadAnswer =
      this.problems.length > 0
        ? { ok: false, problems: dedupe(this.problems) }
        : {
            ok: true,
            answer: { declined: this.declined, blocks: this.blocks, followUps: this.followUps },
          };
    return { delta, answer };
  }

  private consume(final: boolean): string {
    let delta = '';
    while (this.buffer.length > 0) {
      const lt = this.buffer.indexOf('<');
      if (lt !== 0) {
        const text = lt === -1 ? this.buffer : this.buffer.slice(0, lt);
        const held = lt === -1 && !final ? heldTokenStart(text) : text.length;
        if (held === 0) break;
        delta += this.text(text.slice(0, held));
        this.buffer = this.buffer.slice(held);
        continue;
      }
      const gt = this.buffer.indexOf('>');
      if (gt === -1 && !final && this.buffer.length <= MAX_TAG_LENGTH) break;
      if (gt === -1 || gt > MAX_TAG_LENGTH) {
        // Not a tag: a stray `<` is text, which the grammar puts only in prose.
        delta += this.text('<');
        this.buffer = this.buffer.slice(1);
        continue;
      }
      this.tag(this.buffer.slice(0, gt + 1));
      this.buffer = this.buffer.slice(gt + 1);
    }
    return delta;
  }

  /** Text between tags: prose in a block (returned to stream), a follow-up, or out of place. */
  private text(text: string): string {
    if (this.followUp !== undefined) {
      this.followUp += text;
      return '';
    }
    const block = this.open;
    if (!block) {
      if (text.trim() !== '') this.problem('text-outside-block');
      return '';
    }
    block.text += text;
    if (text.trim() === '') {
      if (block.streamed) block.heldSpace += text;
      return '';
    }
    const leading = text.length - text.trimStart().length;
    const body = text.trimEnd();
    const trailing = text.slice(body.length);
    let out: string;
    if (block.streamed) {
      out = block.heldSpace + body;
    } else {
      out = (this.streamedBlocks > 0 ? PARAGRAPH : '') + body.slice(leading);
      block.streamed = true;
      this.streamedBlocks++;
    }
    block.heldSpace = trailing;
    return out;
  }

  private tag(raw: string): void {
    const match = TAG.exec(raw);
    const index = this.blocks.length;
    if (!match) {
      this.problem('unknown-tag', this.open ? index : undefined);
      return;
    }
    const [, closing, name, rawAttributes = ''] = match;
    const attributes = new Map(
      [...rawAttributes.matchAll(ATTRIBUTE)].map(([, key = '', value = '']) => [key, value]),
    );
    const block = this.open;
    switch (closing ? `/${name}` : name) {
      case 'block':
        if (block || this.followUp !== undefined) {
          this.problem('nested-block', index);
          return;
        }
        if (this.declined) this.problem('declined-with-answer');
        this.open = {
          text: '',
          cites: 0,
          passageIds: [],
          links: 0,
          sectionLink: null,
          streamed: false,
          heldSpace: '',
        };
        return;
      case '/block': {
        if (!block) {
          this.problem('misplaced-tag');
          return;
        }
        this.open = undefined;
        const text = block.text.trim().replace(/[ \t]{2,}/g, ' ');
        if (text === '') this.problem('empty-block', index);
        if (block.passageIds.length === 0) this.problem('uncited-block', index);
        this.blocks.push({ text, passageIds: block.passageIds, sectionLink: block.sectionLink });
        return;
      }
      case 'cite':
        if (!block) {
          this.problem('misplaced-tag');
          return;
        }
        if (++block.cites > 1) {
          this.problem('cite-repeated', index);
          return;
        }
        block.passageIds = (attributes.get('ids') ?? '')
          .split(',')
          .map((id) => id.trim())
          .filter((id) => id !== '');
        return;
      case 'link': {
        if (!block) {
          this.problem('misplaced-tag');
          return;
        }
        if (++block.links > 1) {
          this.problem('link-repeated', index);
          return;
        }
        const section = attributes.get('section');
        if (!section) {
          this.problem('link-invalid', index);
          return;
        }
        const field = attributes.get('field');
        block.sectionLink = {
          sectionKey: section,
          fieldPath: field === '' ? null : (field ?? null),
        };
        return;
      }
      case 'followup':
        if (block || this.followUp !== undefined) {
          this.problem('misplaced-tag', block ? index : undefined);
          return;
        }
        this.followUp = '';
        return;
      case '/followup':
        if (this.followUp === undefined) {
          this.problem('misplaced-tag');
          return;
        }
        this.followUps.push(this.followUp.trim());
        this.followUp = undefined;
        return;
      case 'declined':
        if (block || this.followUp !== undefined) {
          this.problem('misplaced-tag', block ? index : undefined);
          return;
        }
        if (this.blocks.length > 0 || this.followUps.length > 0) {
          this.problem('declined-with-answer');
        }
        this.declined = true;
        return;
      default:
        this.problem('unknown-tag', block ? index : undefined);
    }
  }

  private problem(kind: ViolationKind, block?: number): void {
    this.problems.push(block === undefined ? { kind } : { kind, block });
  }
}

/** A stored answer's blocks as the deltas streamed them: paragraphs, blank-line separated. */
export function answerProse(answer: Pick<AnswerOutput, 'blocks'>): string {
  return answer.blocks.map((block) => block.text).join(PARAGRAPH);
}

/**
 * How much of `text` may stream now: all of it, unless it ends in what may be the start of an
 * identifier token, which is held back until the token is whole and can be restored.
 */
function heldTokenStart(text: string): number {
  const last = text.lastIndexOf('[');
  if (last === -1) return text.length;
  for (const start of [last - 1, last]) {
    if (start >= 0 && TOKEN_PREFIX.test(text.slice(start))) return start;
  }
  return text.length;
}

function dedupe(problems: OutputViolation[]): OutputViolation[] {
  const seen = new Set<string>();
  return problems.filter((problem) => {
    const key = JSON.stringify(problem);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
