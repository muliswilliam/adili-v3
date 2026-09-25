import { Alert, AlertDescription, AlertTitle, Button } from '@adili/ui';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft, CircleAlert, Construction } from 'lucide-react';

import { isVerificationId, normalizeVerificationId } from '../lib/verification-id';

export const Route = createFileRoute('/v/$verificationId')({
  head: () => ({ meta: [{ name: 'robots', content: 'noindex' }] }),
  component: VerificationResult,
});

function VerificationResult() {
  const { verificationId } = Route.useParams();
  const id = normalizeVerificationId(verificationId);
  const valid = isVerificationId(id);

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <p className="text-sm text-muted-foreground">Verification code</p>
        <p className="font-mono text-xl font-medium tracking-wide break-all">{id}</p>
      </div>
      {valid ? (
        <Alert variant="warning">
          <Construction aria-hidden="true" />
          <AlertTitle>Verification is not available yet</AlertTitle>
          <AlertDescription>
            The verification service is not connected to this page yet, so this document cannot be
            checked here. Do not treat this page as confirmation that the document is genuine.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertTitle>This is not a valid verification code</AlertTitle>
          <AlertDescription>
            Check the code printed under the QR code and try again.
          </AlertDescription>
        </Alert>
      )}
      <Button asChild variant="link" className="justify-self-start">
        <Link to="/">
          <ArrowLeft aria-hidden="true" />
          Verify another document
        </Link>
      </Button>
    </div>
  );
}
