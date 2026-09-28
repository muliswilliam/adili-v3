import { useToast } from '@adili/ui';

import { goToSignIn } from '../sign-in-redirect';
import { messages as m } from './messages';
import { downloadRosterTemplate, type RosterTemplateFormat } from './template-download';

/**
 * Downloads the roster template in a format: saves the file, sends the user to sign in again
 * (back to `returnTo`) when the session has ended, or says the download failed.
 */
export function useTemplateDownload(returnTo: string) {
  const { toast } = useToast();
  return async (format: RosterTemplateFormat) => {
    const outcome = await downloadRosterTemplate(format);
    if (outcome === 'unauthenticated') {
      goToSignIn(returnTo);
    } else if (outcome === 'failed') {
      toast({ title: m.templateError, urgency: 'assertive' });
    }
  };
}
