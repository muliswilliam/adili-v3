import { Button, Card, CardContent, Icon, Input, Label } from '@adili/ui';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { QrCodeIcon } from '@hugeicons/core-free-icons';
import { type SubmitEvent, useId, useState } from 'react';

import { isVerificationId, normalizeVerificationId } from '../lib/verification-id';

export const Route = createFileRoute('/')({
  component: VerifyHome,
});

function VerifyHome() {
  const navigate = useNavigate();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = normalizeVerificationId(value);
    if (!isVerificationId(id)) {
      setError('Enter the code exactly as printed under the QR code, starting with ADL.');
      return;
    }
    void navigate({ to: '/v/$verificationId', params: { verificationId: id } });
  }

  return (
    <div className="grid gap-8">
      <div className="grid gap-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-muted text-secondary-foreground">
          <Icon icon={QrCodeIcon} className="size-6" />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">Verify a document</h1>
        <p className="text-pretty text-muted-foreground">
          Scan the QR code on an acknowledgement, letter or certificate, or enter the verification
          code printed under it.
        </p>
      </div>
      <Card>
        <CardContent>
          <form className="grid gap-4" onSubmit={submit} noValidate>
            <div className="grid gap-2">
              <Label htmlFor={inputId}>Verification code</Label>
              <Input
                id={inputId}
                name="verificationId"
                placeholder="ADL-7Q4K-M2XR-9HTC"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono tracking-wide uppercase placeholder:normal-case"
                value={value}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : hintId}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                }}
              />
              {error ? (
                <p id={errorId} className="text-sm text-destructive-subtle-foreground">
                  {error}
                </p>
              ) : (
                <p id={hintId} className="text-sm text-muted-foreground">
                  Codes are not case sensitive.
                </p>
              )}
            </div>
            <Button type="submit" className="w-full">
              Verify
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
