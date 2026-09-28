import { Button, CheckboxItem, cn, focusRing, Icon, Input, Label, Spinner } from '@adili/ui';
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
import type { I18n } from '../i18n';
import type { KcContext } from '../KcContext';
import { type Audience, audienceCopy, audienceOf, messageIsOneOf } from '../shared';
import Template from '../Template';

type UpdatePasswordProps = PageProps<
  Extract<KcContext, { pageId: 'login-update-password.ftl' }>,
  I18n
>;

interface Rule {
  label: string;
  /** Checked as the user types; rules the page cannot check (the identifier) have none. */
  met?: (password: string) => boolean;
}

type CountedPolicy = 'length' | 'digits' | 'upperCase' | 'lowerCase' | 'specialChars';

/** The realm's minimum-count policies, in the order they are listed. */
const COUNTED_RULES: readonly {
  policy: CountedPolicy;
  label:
    | 'adiliRuleLength'
    | 'adiliRuleDigits'
    | 'adiliRuleUpperCase'
    | 'adiliRuleLowerCase'
    | 'adiliRuleSpecialChars';
  count: (password: string) => number;
}[] = [
  { policy: 'length', label: 'adiliRuleLength', count: (p) => p.length },
  { policy: 'digits', label: 'adiliRuleDigits', count: (p) => matches(p, /\d/g) },
  { policy: 'upperCase', label: 'adiliRuleUpperCase', count: (p) => matches(p, /\p{Lu}/gu) },
  { policy: 'lowerCase', label: 'adiliRuleLowerCase', count: (p) => matches(p, /\p{Ll}/gu) },
  {
    policy: 'specialChars',
    label: 'adiliRuleSpecialChars',
    count: (p) => matches(p, /[^\p{L}\p{N}\s]/gu),
  },
];

function matches(password: string, pattern: RegExp): number {
  return password.match(pattern)?.length ?? 0;
}

/**
 * The rules the realm enforces, from Keycloak's `passwordPolicies`. None when Keycloak does not
 * pass the policy: the page does not guess at rules the realm may not have.
 */
export function passwordRules(
  policy: PasswordPolicies | undefined,
  i18n: I18n,
  audience: Audience,
): Rule[] {
  if (!policy) return [];
  const rules: Rule[] = [];
  for (const { policy: name, label, count } of COUNTED_RULES) {
    const minimum = policy[name];
    if (minimum) {
      rules.push({
        label: i18n.msgStr(label, String(minimum)),
        met: (password) => count(password) >= minimum,
      });
    }
  }
  if (policy.notUsername || policy.notEmail) {
    rules.push({ label: audienceCopy(audience, i18n).msgStr('ruleNotIdentifier') });
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
  const rules = passwordRules(passwordPolicies, i18n, audienceOf(kcContext));
  const mismatch = confirmation !== '' && confirmation !== password;

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      // Keycloak's "You need to change your password" warning repeats the title.
      displayMessage={
        serverError === undefined && !messageIsOneOf(kcContext, i18n, ['updatePasswordMessage'])
      }
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
            aria-describedby={rules.length > 0 ? 'password-rules' : undefined}
          />
          {rules.length > 0 ? (
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
                    className={cn(
                      'flex items-center gap-2',
                      met && 'text-success-subtle-foreground',
                    )}
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
          ) : null}
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
        className={cn(
          focusRing,
          // Inset, so the ring stays inside the password field.
          'absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:-outline-offset-2',
        )}
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
