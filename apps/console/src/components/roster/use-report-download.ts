import { useToast } from '@adili/ui';
import { useState } from 'react';

import type { RosterImport } from '../../server/directory/client';
import { downloadAttachment } from '../download';
import { goToSignIn } from '../sign-in-redirect';
import { reportFileName } from './import-report';
import { messages as m } from './messages';

/**
 * Downloads an import's rejected rows as CSV from `url` (`reportCsvUrl`), saved under the name the directory gives it
 * (`<file>-rejected-rows.csv`): sends the user to sign in again (back to `returnTo`) when the
 * session has ended, or says the download failed. `downloading` is true while it runs.
 */
export function useReportDownload(
  imp: Pick<RosterImport, 'fileName'>,
  url: string,
  returnTo: string,
) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    const outcome = await downloadAttachment(url, reportFileName(imp.fileName));
    setDownloading(false);
    if (outcome === 'unauthenticated') {
      goToSignIn(returnTo);
    } else if (outcome === 'failed') {
      toast({ title: m.downloadRejectedError, urgency: 'assertive' });
    }
  };
  return { downloading, download };
}
