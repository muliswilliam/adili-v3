import { Card, Spinner } from '@adili/ui';

/** Copy of the acknowledgement slip card (spec 06 FE-3). */
export const SLIP_COPY = {
  preparing: 'Preparing your acknowledgement slip…',
  preparingHint: 'Usually a few seconds. We also email it to you.',
} as const;

/**
 * The acknowledgement slip of a submitted version on the success page. For now it says the slip
 * is being prepared, which is what the service answers right after submission. Polling
 * `getAcknowledgement`, the issued card (download, verification code, QR, verified count) and
 * the failed state with reissue come in #142, from the declaration id, version number and
 * acknowledgement the success page has loaded.
 */
export function SlipCard() {
  return (
    <Card className="p-0 sm:p-0">
      <div role="status" aria-live="polite" className="flex items-center gap-3.5 px-5 py-[22px]">
        <Spinner className="text-foreground" />
        <div className="grid gap-0.5">
          <p className="font-semibold">{SLIP_COPY.preparing}</p>
          <p className="text-sm text-muted-foreground">{SLIP_COPY.preparingHint}</p>
        </div>
      </div>
    </Card>
  );
}
