import { Badge, Icon, type IconProps, type Tone } from '@adili/ui';
import { Edit02Icon, Login01Icon, QrCodeIcon, ViewIcon } from '@hugeicons/core-free-icons';

import type { AuditKind } from '../../server/audit/types';
import { messages as t } from './messages';

const KIND_STYLE: Record<AuditKind, { icon: IconProps['icon']; tone: Tone }> = {
  read: { icon: ViewIcon, tone: 'info' },
  write: { icon: Edit02Icon, tone: 'default' },
  verification: { icon: QrCodeIcon, tone: 'success' },
  auth: { icon: Login01Icon, tone: 'warning' },
};

/** What kind of event a row is: a read, a change, a verify lookup or a sign-in fact. */
export function KindBadge({ kind }: { kind: AuditKind }) {
  const { icon, tone } = KIND_STYLE[kind];
  return (
    <Badge variant={tone}>
      <Icon icon={icon} />
      {t.kinds[kind]}
    </Badge>
  );
}

/** A long id or hash cut to its start and end, whole on hover and for assistive technology. */
export function ShortId({ value, keep = 8 }: { value: string; keep?: number }) {
  if (value.length <= keep * 2 + 1)
    return <span className="font-mono whitespace-nowrap">{value}</span>;
  return (
    <span className="font-mono whitespace-nowrap" title={value}>
      <span aria-hidden="true">{`${value.slice(0, keep)}…${value.slice(-4)}`}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}

/** Keycloak's roles every account holds, which say nothing about what the actor may do. */
const BUILT_IN_ROLES = /^(default-roles-.*|offline_access|uma_authorization)$/;

/** The roles worth showing: the platform's own, without Keycloak's built-in ones. */
export function meaningfulRoles(roles: readonly string[]): string[] {
  return roles.filter((role) => !BUILT_IN_ROLES.test(role));
}
