import type { DeclarationsClient } from './declarations/client.server';
import type { Language } from '../language';
import type { HelpPassageDetail } from './declarations/types';
import { attempt, type NotFound, notFound, type Unavailable, unavailable } from './results';

/**
 * The help pages' reads from the declarations service (spec 11 FE-3) beside help search
 * (`searchHelp` in `assistant.server.ts`). Pure: the caller injects the client.
 */

export type HelpPassageResult =
  { status: 'ok'; passage: HelpPassageDetail } | NotFound | Unavailable;

/** One passage of the law or one help article, whole, in `language` where it has it. */
export function getHelpPassage(
  client: DeclarationsClient,
  query: { passageId: string; language: Language },
): Promise<HelpPassageResult> {
  return attempt(async (): Promise<HelpPassageResult> => {
    const { data, response } = await client.GET('/v1/help/passages/{passageId}', {
      params: { path: { passageId: query.passageId }, query: { language: query.language } },
    });
    if (data) return { status: 'ok', passage: data };
    return response.status === 404 ? notFound : unavailable;
  });
}
