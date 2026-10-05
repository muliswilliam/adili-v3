import { COMMISSION_ADMIN, PLATFORM_ADMIN, REPORTING_OFFICER, REVIEWER } from '@adili/roles';
import { describe, expect, it } from 'vitest';

import { helpScopeOfPage, helpScopeSearch, helpWorkspaceFor, helpWorkspacesFor } from './scope';

const platform = { scope: { kind: 'platform' }, readOnly: false };
const commission = (readOnly: boolean) => ({
  scope: { kind: 'commission', slug: 'cpsbnairobicity' },
  readOnly,
});

describe('help workspaces', () => {
  it("offers a platform admin the platform's help only", () => {
    expect(helpWorkspacesFor([PLATFORM_ADMIN], 'platform')).toEqual([platform]);
    expect(helpWorkspaceFor([PLATFORM_ADMIN], 'platform', 'commission')).toEqual(platform);
  });

  it("offers a Commission's administrator or reporting officer their Commission's only", () => {
    expect(helpWorkspacesFor([COMMISSION_ADMIN], 'cpsbnairobicity')).toEqual([commission(false)]);
    expect(helpWorkspacesFor([REPORTING_OFFICER], 'cpsbnairobicity')).toEqual([commission(true)]);
    expect(helpWorkspaceFor([REPORTING_OFFICER], 'cpsbnairobicity', 'platform')).toEqual(
      commission(true),
    );
  });

  it("offers a platform admin with a Commission role both, the platform's first", () => {
    const roles = [PLATFORM_ADMIN, COMMISSION_ADMIN];
    expect(helpWorkspacesFor(roles, 'cpsbnairobicity')).toEqual([platform, commission(false)]);
    expect(helpWorkspaceFor(roles, 'cpsbnairobicity')).toEqual(platform);
    expect(helpWorkspaceFor(roles, 'cpsbnairobicity', 'platform')).toEqual(platform);
    expect(helpWorkspaceFor(roles, 'cpsbnairobicity', 'commission')).toEqual(commission(false));
    expect(
      helpWorkspaceFor([PLATFORM_ADMIN, REPORTING_OFFICER], 'cpsbnairobicity', 'commission'),
    ).toEqual(commission(true));
  });

  it('offers no Commission without a Commission tenant', () => {
    expect(helpWorkspacesFor([PLATFORM_ADMIN, COMMISSION_ADMIN], 'platform')).toEqual([platform]);
    expect(helpWorkspacesFor([COMMISSION_ADMIN], null)).toEqual([]);
  });

  it('offers nothing to anyone else', () => {
    expect(helpWorkspacesFor([REVIEWER], 'cpsbnairobicity')).toEqual([]);
    expect(helpWorkspaceFor([REVIEWER], 'cpsbnairobicity', 'commission')).toBeNull();
  });
});

describe('help scope in the URL', () => {
  it('reads the chosen scope and drops anything else', () => {
    expect(helpScopeSearch.parse({ scope: 'commission' })).toEqual({ scope: 'commission' });
    expect(helpScopeSearch.parse({ scope: 'platform' })).toEqual({ scope: 'platform' });
    expect(helpScopeSearch.parse({ scope: 'cpsbnairobicity' })).toEqual({ scope: undefined });
    expect(helpScopeSearch.parse({})).toEqual({ scope: undefined });
  });
});

describe('help scope of a page', () => {
  it("takes the themes page for the Commission's and the corpus for the platform's", () => {
    expect(helpScopeOfPage('/help/themes')).toBe('commission');
    expect(helpScopeOfPage('/help/corpus')).toBe('platform');
  });

  it('leaves the articles to the scope chosen, or the first', () => {
    expect(helpScopeOfPage('/help')).toBeUndefined();
    expect(helpScopeOfPage('/help/articles/new')).toBeUndefined();
  });
});
