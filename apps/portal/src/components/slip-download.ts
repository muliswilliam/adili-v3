import { useToast } from '@adili/ui';
import { useState } from 'react';

import { getMySlipDownload } from '../server/submission';
import { downloadFrom } from './download';

export const SLIP_DOWNLOAD_FAILED = 'We could not download your slip. Try again.';

/**
 * Downloads an issued acknowledgement slip: a short-lived link fetched from the documents service
 * on click, then the browser saves the file; a toast says so when the link could not be had.
 * `pending` is the document being fetched, for its button's spinner.
 */
export function useSlipDownload() {
  const { toast } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  async function download(documentId: string) {
    setPending(documentId);
    const link = await getMySlipDownload({ data: { documentId } }).catch(() => null);
    setPending(null);
    if (link?.status === 'ok') downloadFrom(link.downloadUrl);
    else toast({ title: SLIP_DOWNLOAD_FAILED, urgency: 'assertive' });
  }
  return { pending, download };
}

export type SlipDownload = ReturnType<typeof useSlipDownload>;
