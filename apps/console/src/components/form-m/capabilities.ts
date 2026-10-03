import { COMMISSION_ADMIN, SUPERVISOR } from '@adili/roles';

import type { Workspace } from '../workspaces';

/** What the viewer may do in their Commission's Form M workspace (spec 09 access table). */
export interface FormMCapabilities {
  /**
   * The supervisor's part: compiles a preview and recompiles the draft (this ticket), then edits
   * remarks and marks it reviewed (#226).
   */
  compilesAndReviews: boolean;
  /** The commission-admin's part: enters Part I and Part B, then confirms and submits (#226). */
  signsOff: boolean;
  /** Reads only (the reporting officer): the workspace is read-only for them. */
  readOnly: boolean;
}

/**
 * The viewer's Form M capabilities, worked out once in the route from their realm roles and the
 * workspace their roles open (`workspaceFor(roles, 'form-m')`, null without it).
 */
export function formMCapabilities(
  roles: readonly string[],
  workspace: Pick<Workspace, 'readOnly'> | null,
): FormMCapabilities {
  return {
    compilesAndReviews: workspace !== null && roles.includes(SUPERVISOR),
    signsOff: workspace !== null && roles.includes(COMMISSION_ADMIN),
    readOnly: workspace?.readOnly ?? true,
  };
}
