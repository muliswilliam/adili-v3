import { Button, CheckboxItem, cn, Icon, Input, Label } from '@adili/ui';
import {
  AlertCircleIcon,
  Tick02Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from '@hugeicons/core-free-icons';
import { kcSanitize } from 'keycloakify/lib/kcSanitize';
import type { PasswordPolicies } from 'keycloakify/login/KcContext';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import { type InputHTMLAttributes, type Ref, useRef, useState } from 'react';

import { PageAlert } from '../components/PageAlert';
import { Spinner } from '../components/Spinner';
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import { audienceOf } from '../shared';
import Template from '../Template';

type UpdatePasswordProps = PageProps<
  Extract<KcContext, { pageId: 'login-update-password.ftl' }>,
  I18n
>;

/** Used when Keycloak does not pass the realm policy: the design's 12 characters, no identifier. */
export const DEFAULT_POLICY: PasswordPolicies = { length: 12, notUsername: true, notEmail: true };

interface Rule {
  label: string;
  /** Checked as the user types; rules the page cannot check (the identifier) have none. */
  met?: (password: string) => boolean;
}

const count = (password: string, pattern: RegExp) => password.match(pattern)?.length ?? 0;

export function passwordRules(
  policy: PasswordPolicies,
  i18n: I18n,
  audience: 'declarant' | 'staff',
): Rule[] {
  const { msgStr } = i18n;
  const rules: Rule[] = [];
  const { length, digits, upperCase, lowerCase, specialChars } = policy;
  if (length) {
    rules.push({
      label: msgStr('adiliRuleLength', String(length)),
      met: (p) => p.length >= length,
    });
  }
  if (digits) {
    rules.push({
      label: msgStr('adiliRuleDigits', String(digits)),
      met: (p) => count(p, /\d/g) >= digits,
    });
  }
  if (upperCase) {
    rules.push({
      label: msgStr('adiliRuleUpperCase', String(upperCase)),
      met: (p) => count(p, /\p{Lu}/gu) >= upperCase,
    });
  }
  if (lowerCase) {
    rules.push({
      label: msgStr('adiliRuleLowerCase', String(lowerCase)),
      met: (p) => count(p, /\p{Ll}/gu) >= lowerCase,
    });
  }
  if (specialChars) {
    rules.push({
      label: msgStr('adiliRuleSpecialChars', String(specialChars)),
      met: (p) => count(p, /[^\p{L}\p{N}\s]/gu) >= specialChars,
    });
  }
  if (policy.notUsername || policy.notEmail) {
    rules.push({
      label: msgStr(
        audience === 'staff' ? 'adiliRuleNotIdentifierStaff' : 'adiliRuleNotIdentifierDeclarant',
      ),
    });
  }
  return rules;
}

/**
 * Set your password (login-update-password.ftl): the UPDATE_PASSWORD required action from the
 * set-password link, and the last step of Forgot password.
 */
export default function UpdatePassword({
  kcContext,
  i18n,
  doUseDefaultCss,
  classes,
}: UpdatePasswordProps) {
  const { url, messagesPerField, isAppInitiatedAction, passwordPolicies } = kcContext;
  const { msg, msgStr } = i18n;
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [showMismatch, setShowMismatch] = useState(false);
  const confirmRef = useRef<HTMLInputElement>(null);

  const serverError = messagesPerField.existsError('password', 'password-confirm')
    ? messagesPerField.getFirstError('password', 'password-confirm')
    : undefined;
  const rules = passwordRules(passwordPolicies ?? DEFAULT_POLICY, i18n, audienceOf(kcContext));
  const mismatch = confirmation !== '' && confirmation !== password;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      displayMessage={serverError === undefined}
      headerNode={msg('adiliSetPasswordTitle')}
    >
      {serverError ? (
        <PageAlert variant="destructive" icon={AlertCircleIcon}>
          <span dangerouslySetInnerHTML={{ __html: kcSanitize(serverError) }} />
        </PageAlert>
      ) : null}
      <form
        id="kc-passwd-update-form"
        action={url.loginAction}
        method="post"
        noValidate
        className="grid gap-5"
        onSubmit={(event) => {
          if (password === '' || confirmation !== password) {
            event.preventDefault();
            setShowMismatch(true);
            confirmRef.current?.focus();
            return;
          }
          setSaving(true);
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="password-new">{msg('adiliNewPassword')}</Label>
          <PasswordInput
            i18n={i18n}
            id="password-new"
            name="password-new"
            autoComplete="new-password"
            autoFocus={serverError === undefined}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            aria-invalid={serverError ? true : undefined}
            aria-describedby="password-rules"
          />
          <ul
            id="password-rules"
            aria-label={msgStr('adiliPasswordRules')}
            className="grid gap-1 text-[13px] text-muted-foreground"
          >
            {rules.map((rule) => {
              const met = rule.met?.(password);
              return (
                <li
                  key={rule.label}
                  className={cn('flex items-center gap-2', met && 'text-success-subtle-foreground')}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex size-4 items-center justify-center rounded-full border',
                      met && 'border-transparent bg-success text-white',
                    )}
                  >
                    {met ? <Icon icon={Tick02Icon} className="size-3" strokeWidth={3} /> : null}
                  </span>
                  {rule.label}
                  {rule.met ? (
                    <span className="sr-only">
                      {' '}
                      {msgStr(met ? 'adiliRuleMet' : 'adiliRuleNotMet')}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="password-confirm">{msg('adiliConfirmPassword')}</Label>
          <PasswordInput
            ref={confirmRef}
            i18n={i18n}
            id="password-confirm"
            name="password-confirm"
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
            onBlur={() => {
              setShowMismatch(true);
            }}
            aria-invalid={(showMismatch && mismatch) || serverError ? true : undefined}
            aria-describedby={showMismatch && mismatch ? 'password-confirm-error' : undefined}
          />
          {showMismatch && mismatch ? (
            <p
              id="password-confirm-error"
              role="alert"
              className="flex items-center gap-1.5 text-[13px] font-medium text-destructive"
            >
              <Icon icon={AlertCircleIcon} className="size-[15px]" />
              {msg('adiliPasswordsDoNotMatch')}
            </p>
          ) : null}
        </div>

        <CheckboxItem
          id="logout-sessions"
          name="logout-sessions"
          value="on"
          defaultChecked
          label={msg('adiliSignOutOtherDevices')}
          hint={msg('adiliSignOutOtherDevicesHint')}
        />

        <div className="grid gap-3">
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? (
              <>
                <Spinner />
                {msg('adiliSaving')}
              </>
            ) : (
              msg('adiliSaveAndContinue')
            )}
          </Button>
          {isAppInitiatedAction ? (
            <Button
              type="submit"
              variant="secondary"
              name="cancel-aia"
              value="true"
              className="w-full"
              formNoValidate
            >
              {msg('doCancel')}
            </Button>
          ) : null}
        </div>
      </form>
    </Template>
  );
}

function PasswordInput({
  i18n,
  className,
  ref,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  i18n: I18n;
  ref?: Ref<HTMLInputElement>;
  id: string;
}) {
  const { msgStr } = i18n;
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="relative">
      <Input
        ref={ref}
        type={revealed ? 'text' : 'password'}
        className={cn('pr-10', className)}
        {...props}
      />
      <button
        type="button"
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={msgStr(revealed ? 'hidePassword' : 'showPassword')}
        aria-controls={props.id}
        onClick={() => {
          setRevealed((current) => !current);
        }}
      >
        <Icon icon={revealed ? ViewOffSlashIcon : ViewIcon} className="size-4" />
      </button>
    </div>
  );
}
