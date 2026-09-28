import { isRosterTemplateFormat } from '../components/roster/template-download';
import {
  defaultDirectoryAttachmentDeps,
  directoryAttachment,
  type DirectoryAttachmentDeps,
  problemResponse,
} from './directory-attachment.server';

export type RosterTemplateDeps = DirectoryAttachmentDeps;

/**
 * `GET /roster/template?format=csv|xlsx`: the roster template from the directory
 * (`getRosterTemplate`), fetched with the signed-in user's token and passed through as the
 * attachment the directory sends. The directory decides who may download it (403 otherwise).
 */
export function rosterTemplateResponse(
  request: Request,
  deps: RosterTemplateDeps = defaultDirectoryAttachmentDeps,
): Promise<Response> {
  const format = new URL(request.url).searchParams.get('format');
  if (!isRosterTemplateFormat(format)) {
    return Promise.resolve(problemResponse(400, 'Unknown template format'));
  }
  return directoryAttachment(request, deps, (client) =>
    client.GET('/v1/roster/template', { params: { query: { format } }, parseAs: 'stream' }),
  );
}
