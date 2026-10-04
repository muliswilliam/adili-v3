import { Injectable, Logger } from '@nestjs/common';
import { notFoundIfInvisible, type Principal } from '@adili/api-kit';
import {
  type Database,
  FieldCipher,
  InjectDatabase,
  type PersonContext,
  withPerson,
} from '@adili/data-access';
import { EventPublisher } from '@adili/events';
import type { DeclarationSectionKey } from '@adili/forms';
import { and, asc, desc, eq, isNull, type SQL } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { z } from 'zod';

import {
  AiGatewayClient,
  AiGatewayUnavailable,
  type AnswerFrame,
  type AnswerInput,
  type AnswerOutput,
} from '../ai-gateway/ai-gateway-client.js';
import { Clock } from '../clock.js';
import { isEditable } from '../declaration/schema.js';
import type { DeclarationsSchema } from '../db/schema.js';
import type { Transaction } from '../db/transaction.js';
import { DirectoryClient } from '../directory/directory-client.js';
import { personOf } from '../drafts/access.js';
import { validationProblem } from '../drafts/problems.js';
import {
  type DeclarationRow,
  documentFrame,
  liveDeclaration,
  liveSections,
  type SectionRow,
} from '../drafts/repository.js';
import { SectionCipher } from '../drafts/section-cipher.js';
import { reviewDraft } from '../drafts/summary.js';
import { isUuid } from '../guards.js';
import { retrieve, type RetrievalQuery, type RetrievedPassage } from '../help/retrieval.js';
import { nairobiDate } from '../obligations/dates.js';
import { filingObligations } from '../obligations/schema.js';
import { checkAnswer, DECLINE_TEXT } from './answer.js';
import { boostTagsOf, householdCountsOf, residualsOf } from './context.js';
import { assistantMessageAnswered } from './events.js';
import { assistantUnavailable } from './problems.js';
import {
  askRequestSchema,
  type AssistantAnswer,
  type AssistantConversation,
  type AssistantMessage,
  type OpenConversationRequest,
  openConversationRequestSchema,
  type ReportingOfficerContact,
} from './representation.js';
import {
  type AssistantLanguage,
  assistantConversations,
  assistantMessages,
  type StoredCitation,
  type StoredSectionLink,
} from './schema.js';

type ConversationRow = typeof assistantConversations.$inferSelect;
type MessageRow = typeof assistantMessages.$inferSelect;

/** A conversation outside a draft is deleted this long after its last message (spec 11 S7). */
export const CONVERSATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Passages retrieved per question (spec 11 BE: top 8). */
export const PASSAGES_PER_QUESTION = 8;

/** Earlier turns sent with a question (ai-gateway.yaml `history.maxItems`), and their length. */
const HISTORY_TURNS = 10;
const HISTORY_TEXT_MAX = 4000;

/** What the portal receives while an answer streams (declarations.yaml `askAssistant`). */
export type AssistantFrame =
  | { event: 'delta'; data: { text: string } }
  | { event: 'final'; data: AssistantAnswer }
  | { event: 'error'; data: { code: 'assistant-unavailable' } };

/** An answer on its way: its frames, read until the declarant goes away (`signal`). */
export interface AnswerStream {
  frames(signal: AbortSignal): AsyncGenerator<AssistantFrame>;
}

/** What a message's ciphertext holds: the text as read, and a decline's contact. */
interface MessagePlaintext {
  text: string;
  reportingOfficer?: ReportingOfficerContact | null;
}

/** Everything an ask needs from the database, read in one person transaction. */
interface Asked {
  conversation: ConversationRow;
  declaration: DeclarationRow | null;
  sections: SectionRow[];
  history: MessageRow[];
}

/** The question about to be answered, as it will be stored. */
interface Question {
  id: string;
  text: string;
  sectionKey: DeclarationSectionKey | null;
  at: Date;
}

/**
 * Ask Adili (spec 11, #333): the declarant's conversation with the assistant, one per draft (or
 * one outside a draft), and answers streamed from the ai-gateway. Aware of where the declarant is,
 * blind to what they wrote: the gateway gets the declaration's type and statement date, the
 * household as counts, the section and what is still missing as rule ids and field paths, and the
 * passages retrieved from the Act, Regulations and help articles; never contents. An answer is
 * stored only when every block cites what was retrieved; otherwise the declarant gets the decline
 * with the reporting officer's contact. Every route is the declarant's own by the `person_id`
 * claim, under person-scoped row-level security; anyone else gets 404.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    @InjectDatabase() private readonly db: Database<DeclarationsSchema>,
    private readonly cipher: FieldCipher,
    private readonly sections: SectionCipher,
    private readonly directory: DirectoryClient,
    private readonly gateway: AiGatewayClient,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  /**
   * The conversation for the draft (or the declarant's outside a draft), created on first open
   * and resumed after, in the language asked for. 404 for a draft that is not the caller's or no
   * longer being edited, and outside a draft for a declarant without a filing obligation (there is
   * no Commission to ask).
   */
  async open(principal: Principal, body: unknown): Promise<AssistantConversation> {
    const person = personOf(principal);
    const request = parse(openConversationRequestSchema, body);
    const now = this.clock.now();
    const { conversation, messages } = await withPerson(this.db, person, async (tx) => {
      const found =
        request.declarationId === null
          ? await this.withoutDraft(tx, person, request, now)
          : await this.ofDraft(tx, person, request, now);
      const row = notFoundIfInvisible(found);
      return { conversation: row, messages: await messagesOf(tx, row.id) };
    });
    return {
      id: conversation.id,
      declarationId: conversation.declarationId,
      language: conversation.language,
      messages: await Promise.all(
        messages.map((message) => this.toMessage(conversation.tenant, message)),
      ),
      expiresAt: conversation.expiresAt?.toISOString() ?? null,
    };
  }

  /**
   * Opens the answer to a question. Throws before anything streams: 400 for a bad body, 404 for a
   * conversation that is not the caller's (or gone with its draft), 503 when the gateway cannot
   * take it. The frames then carry the answer as it is written and end with both turns as stored,
   * or with an error, after which nothing is stored. A declarant who leaves ends the gateway's job,
   * and nothing is stored either.
   */
  async ask(principal: Principal, conversationId: string, body: unknown): Promise<AnswerStream> {
    const person = personOf(principal);
    const request = parse(askRequestSchema, body);
    const now = this.clock.now();
    const asked = notFoundIfInvisible(await this.read(person, conversationId, now));
    const { conversation, declaration } = asked;
    const language = conversation.language;
    const liveKeys = new Set<string>(asked.sections.map((section) => section.sectionKey));
    const sectionKey =
      declaration && request.sectionKey !== null && liveKeys.has(request.sectionKey)
        ? (request.sectionKey as DeclarationSectionKey)
        : null;
    const question: Question = { id: uuidv7(), text: request.text, sectionKey, at: now };
    const answerId = uuidv7();
    const history = await this.history(conversation, asked.history);
    const passages = await this.passagesFor(
      person,
      request.text,
      history.findLast((turn) => turn.role === 'user')?.text,
      {
        language,
        date: nairobiDate(now),
        boost: boostTagsOf(sectionKey, request.itemType),
        // The platform's articles and the conversation's Commission's: an answer about a PSC
        // draft never rests on another Commission's practice.
        tenant: conversation.tenant,
      },
    );
    const retrieved = new Set(passages.map((passage) => passage.id));
    const store = (output: AnswerOutput | null, jobId: string | null) =>
      this.store(person, conversation, question, answerId, {
        output,
        jobId,
        passages,
        retrieved,
        liveKeys,
      });

    if (passages.length === 0) {
      // Nothing in the corpus to ground an answer in: decline without asking the gateway.
      return {
        frames: async function* () {
          const stored = await store(null, null);
          yield stored ? { event: 'final', data: stored } : unavailableFrame();
        },
      };
    }

    const input: AnswerInput = {
      kind: 'answer-declarant-question',
      mode: 'answer',
      language,
      question: request.text,
      context: {
        declarationType: declaration?.type ?? null,
        statementDate: declaration?.statementDate ?? null,
        householdCounts: householdCountsOf(
          asked.sections.find((section) => section.sectionKey === 'household')?.metadata,
        ),
        sectionKey,
        residuals: declaration ? await this.residuals(declaration, asked.sections, sectionKey) : [],
      },
      passages: passages.map(({ id, citation, text }) => ({ id, citation, text })),
      history,
    };
    const upstream = new AbortController();
    let frames: AsyncIterable<AnswerFrame>;
    try {
      frames = await this.gateway.streamAnswer(
        {
          tenant: conversation.tenant,
          subjectRef: `assistant-conversation:${conversation.id}`,
          input,
        },
        answerId,
        upstream.signal,
      );
    } catch (error) {
      if (error instanceof AiGatewayUnavailable) {
        this.logger.warn({ err: error }, 'The ai-gateway did not take a question');
        throw assistantUnavailable();
      }
      throw error;
    }
    const logger = this.logger;
    return {
      frames: async function* (signal) {
        const leave = () => {
          upstream.abort();
        };
        signal.addEventListener('abort', leave, { once: true });
        try {
          for await (const frame of frames) {
            if (signal.aborted) return;
            if (frame.event === 'delta') {
              yield { event: 'delta', data: { text: frame.text } };
              continue;
            }
            if (frame.event === 'error') {
              yield unavailableFrame();
              return;
            }
            const stored = await store(frame.job.output, frame.job.id);
            yield stored ? { event: 'final', data: stored } : unavailableFrame();
            return;
          }
          if (!signal.aborted) yield unavailableFrame();
        } catch (error) {
          if (signal.aborted) return;
          logger.warn({ err: error }, 'An answer stream failed');
          yield unavailableFrame();
        } finally {
          signal.removeEventListener('abort', leave);
          upstream.abort();
        }
      },
    };
  }

  /** The draft's conversation, created or resumed in the language asked for. */
  private async ofDraft(
    tx: Transaction,
    person: PersonContext,
    request: OpenConversationRequest,
    now: Date,
  ): Promise<ConversationRow | null> {
    const declarationId = request.declarationId ?? '';
    const declaration = await liveDeclaration(tx, declarationId);
    if (!declaration || !isEditable(declaration.status)) return null;
    await tx
      .insert(assistantConversations)
      .values({
        id: uuidv7(),
        personId: person.personId,
        declarationId: declaration.id,
        tenant: declaration.tenant,
        language: request.language,
        createdAt: now,
      })
      .onConflictDoNothing();
    return this.inLanguage(
      tx,
      await conversationWhere(tx, eq(assistantConversations.declarationId, declaration.id)),
      request.language,
    );
  }

  /**
   * The declarant's conversation outside a draft: a new one once the last has expired, at the
   * Commission of their latest filing obligation.
   */
  private async withoutDraft(
    tx: Transaction,
    person: PersonContext,
    request: OpenConversationRequest,
    now: Date,
  ): Promise<ConversationRow | null> {
    const mine = and(
      eq(assistantConversations.personId, person.personId),
      isNull(assistantConversations.declarationId),
    );
    const current = await conversationWhere(tx, mine);
    if (current && isExpired(current, now)) {
      await tx.delete(assistantConversations).where(eq(assistantConversations.id, current.id));
    } else if (current) {
      return this.inLanguage(tx, current, request.language);
    }
    const [obligation] = await tx
      .select({ tenant: filingObligations.tenant })
      .from(filingObligations)
      .where(eq(filingObligations.personId, person.personId))
      .orderBy(desc(filingObligations.dueDate), desc(filingObligations.createdAt))
      .limit(1);
    if (!obligation) return null;
    await tx
      .insert(assistantConversations)
      .values({
        id: uuidv7(),
        personId: person.personId,
        declarationId: null,
        tenant: obligation.tenant,
        language: request.language,
        createdAt: now,
        expiresAt: new Date(now.getTime() + CONVERSATION_TTL_MS),
      })
      .onConflictDoNothing();
    return this.inLanguage(tx, await conversationWhere(tx, mine), request.language);
  }

  private async inLanguage(
    tx: Transaction,
    conversation: ConversationRow | null,
    language: AssistantLanguage,
  ): Promise<ConversationRow | null> {
    if (!conversation || conversation.language === language) return conversation;
    const [updated] = await tx
      .update(assistantConversations)
      .set({ language })
      .where(eq(assistantConversations.id, conversation.id))
      .returning();
    return updated ?? null;
  }

  /** The conversation, its draft and live sections, and its recent turns. */
  private read(person: PersonContext, conversationId: string, now: Date): Promise<Asked | null> {
    return withPerson(this.db, person, async (tx) => {
      if (!isUuid(conversationId)) return null;
      const conversation = await conversationWhere(
        tx,
        eq(assistantConversations.id, conversationId),
      );
      if (!conversation || isExpired(conversation, now)) return null;
      let declaration: DeclarationRow | null = null;
      let sections: SectionRow[] = [];
      if (conversation.declarationId !== null) {
        declaration = await liveDeclaration(tx, conversation.declarationId);
        if (!declaration || !isEditable(declaration.status)) return null;
        sections = await liveSections(tx, declaration.id);
      }
      const recent = await tx
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.conversationId, conversation.id))
        .orderBy(desc(assistantMessages.at), desc(assistantMessages.id))
        .limit(HISTORY_TURNS);
      return { conversation, declaration, sections, history: recent.reverse() };
    });
  }

  /**
   * The passages for the question, in force today, of the law and of the articles the declarant
   * may read. A follow-up ("and the loan on it?") that finds nothing alone is read together with
   * the question before it.
   */
  private async passagesFor(
    person: PersonContext,
    question: string,
    previous: string | undefined,
    query: Omit<RetrievalQuery, 'question' | 'limit'>,
  ): Promise<RetrievedPassage[]> {
    const search = (text: string) =>
      withPerson(this.db, person, (tx) =>
        retrieve(tx, { ...query, question: text, limit: PASSAGES_PER_QUESTION }),
      );
    const passages = await search(question);
    if (passages.length > 0 || previous === undefined) return passages;
    return search(`${previous} ${question}`);
  }

  /** What the completeness check still reports on the draft, as rule ids and field paths. */
  private async residuals(
    declaration: DeclarationRow,
    sections: SectionRow[],
    current: DeclarationSectionKey | null,
  ): Promise<AnswerInput['context']['residuals']> {
    const review = reviewDraft(
      documentFrame(declaration),
      await this.sections.openAll(declaration.tenant, sections),
      sections.map((section) => ({ key: section.sectionKey, completeness: section.completeness })),
    );
    return residualsOf(review.blocking, current);
  }

  /**
   * Earlier turns as the gateway gets them, each in the language it was given in: a decline as
   * its text, never the reporting officer's contact stored with it.
   */
  private history(
    conversation: ConversationRow,
    messages: MessageRow[],
  ): Promise<AnswerInput['history']> {
    return Promise.all(
      messages.map(async (message) => ({
        role: message.role,
        text: (await this.unseal(conversation.tenant, message)).text.slice(0, HISTORY_TEXT_MAX),
      })),
    );
  }

  /**
   * Stores the question and its answer (checked against the passages retrieved, or the decline
   * with the reporting officer's contact) in one transaction, with the event; both as the portal
   * shows them. Null when the conversation went meanwhile (its draft was discarded or submitted,
   * or it expired).
   */
  private async store(
    person: PersonContext,
    conversation: ConversationRow,
    question: Question,
    answerId: string,
    answered: {
      output: AnswerOutput | null;
      jobId: string | null;
      passages: RetrievedPassage[];
      retrieved: ReadonlySet<string>;
      liveKeys: ReadonlySet<string>;
    },
  ): Promise<AssistantAnswer | null> {
    const checked = answered.output
      ? checkAnswer(answered.output, answered.retrieved, answered.liveKeys)
      : ({ declined: true } as const);
    const byId = new Map(answered.passages.map((passage) => [passage.id, passage]));
    const citations: StoredCitation[] = checked.declined
      ? []
      : checked.passageIds.flatMap((id) => {
          const passage = byId.get(id);
          return passage
            ? [
                {
                  id: passage.id,
                  source: passage.source,
                  citation: passage.citation,
                  title: passage.title,
                  snippet: passage.snippet,
                  language: passage.language,
                },
              ]
            : [];
        });
    const answerText: MessagePlaintext = checked.declined
      ? {
          text: DECLINE_TEXT[conversation.language],
          reportingOfficer: await this.reportingOfficer(conversation.tenant),
        }
      : { text: checked.text };
    const sectionLink: StoredSectionLink | null = checked.declined ? null : checked.sectionLink;
    const answeredAt = this.clock.now();
    const [questionSealed, answerSealed] = await Promise.all([
      this.seal(conversation.tenant, question.id, { text: question.text }),
      this.seal(conversation.tenant, answerId, answerText),
    ]);
    const rows = await withPerson(this.db, person, async (tx) => {
      // Gone with its draft, or expired, while the answer streamed: nothing is stored.
      const [live] = await tx
        .select()
        .from(assistantConversations)
        .where(eq(assistantConversations.id, conversation.id))
        .for('update');
      if (!live || isExpired(live, answeredAt)) return null;
      const inserted = await tx
        .insert(assistantMessages)
        .values([
          {
            id: question.id,
            conversationId: conversation.id,
            role: 'user',
            ...questionSealed,
            sectionKey: question.sectionKey,
            at: question.at,
          },
          {
            id: answerId,
            conversationId: conversation.id,
            role: 'assistant',
            ...answerSealed,
            citations,
            sectionLink,
            jobId: answered.jobId,
            declined: checked.declined,
            label: answered.output?.label ?? null,
            at: answeredAt,
          },
        ])
        .returning();
      await tx
        .update(assistantConversations)
        .set({
          lastMessageAt: answeredAt,
          ...(conversation.declarationId === null
            ? { expiresAt: new Date(answeredAt.getTime() + CONVERSATION_TTL_MS) }
            : {}),
        })
        .where(eq(assistantConversations.id, conversation.id));
      await this.events.record(
        tx,
        assistantMessageAnswered({
          conversationId: conversation.id,
          messageId: answerId,
          tenant: conversation.tenant,
          sectionKey: question.sectionKey,
          declined: checked.declined,
          jobId: answered.jobId,
        }),
      );
      return inserted;
    });
    if (!rows) return null;
    const [questionRow, answerRow] = [
      rows.find((row) => row.id === question.id),
      rows.find((row) => row.id === answerId),
    ];
    if (!questionRow || !answerRow) throw new Error('insert returned no row');
    return {
      question: toMessage(questionRow, { text: question.text }),
      answer: toMessage(answerRow, answerText),
    };
  }

  /**
   * The Commission's reporting officer, whom a decline sends the declarant to; null when it has
   * none on record or the directory cannot say now (the decline still says to ask them).
   */
  private async reportingOfficer(tenant: string): Promise<ReportingOfficerContact | null> {
    try {
      const [officer] = await this.directory.listReportingOfficers(tenant);
      return officer ? { name: officer.name, email: officer.email, phone: null } : null;
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not read the reporting officer for a decline');
      return null;
    }
  }

  private async seal(
    tenant: string,
    messageId: string,
    plaintext: MessagePlaintext,
  ): Promise<Pick<MessageRow, 'ciphertext' | 'envelope'>> {
    const { ciphertext, envelope } = await this.cipher.encrypt({
      tenant,
      recordId: recordId(messageId),
      plaintext: JSON.stringify(plaintext),
    });
    return { ciphertext: Buffer.from(ciphertext, 'base64'), envelope };
  }

  private async unseal(tenant: string, message: MessageRow): Promise<MessagePlaintext> {
    const plaintext = await this.cipher.decrypt({
      tenant,
      recordId: recordId(message.id),
      ciphertext: message.ciphertext.toString('base64'),
      envelope: message.envelope,
    });
    return JSON.parse(plaintext.toString('utf8')) as MessagePlaintext;
  }

  private async toMessage(tenant: string, message: MessageRow): Promise<AssistantMessage> {
    return toMessage(message, await this.unseal(tenant, message));
  }
}

function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw validationProblem(
    parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  );
}

/** The last frame of an answer that could not be had: nothing was stored. */
export function unavailableFrame(): AssistantFrame {
  return { event: 'error', data: { code: 'assistant-unavailable' } };
}

/** The AAD record id of a message's ciphertext: it cannot be moved to another message. */
function recordId(messageId: string): string {
  return `assistant-message/${messageId}`;
}

function isExpired(conversation: ConversationRow, now: Date): boolean {
  return conversation.expiresAt !== null && conversation.expiresAt.getTime() <= now.getTime();
}

async function conversationWhere(
  tx: Transaction,
  where: SQL | undefined,
): Promise<ConversationRow | null> {
  const [row] = await tx.select().from(assistantConversations).where(where).limit(1);
  return row ?? null;
}

function messagesOf(tx: Transaction, conversationId: string): Promise<MessageRow[]> {
  return tx
    .select()
    .from(assistantMessages)
    .where(eq(assistantMessages.conversationId, conversationId))
    .orderBy(asc(assistantMessages.at), asc(assistantMessages.id));
}

function toMessage(row: MessageRow, plaintext: MessagePlaintext): AssistantMessage {
  return {
    id: row.id,
    role: row.role,
    text: plaintext.text,
    citations: row.citations,
    sectionLink: row.sectionLink,
    declined: row.declined,
    reportingOfficer: plaintext.reportingOfficer ?? null,
    label: row.label,
    rating: row.rating,
    at: row.at.toISOString(),
  };
}
