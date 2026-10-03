import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { parse } from 'yaml';

import { RELEASE_STATUSES, ReleaseStatusBadge } from './release-status-badge';

describe('ReleaseStatusBadge', () => {
  it('says a release is a preview, in blue', () => {
    render(<ReleaseStatusBadge status="preview" />);

    const badge = screen.getByText('Preview');
    expect(badge.className).toContain('text-info-subtle-foreground');
    expect(badge.dataset.status).toBe('preview');
  });

  it('says a release is published, in green', () => {
    render(<ReleaseStatusBadge status="published" />);

    expect(screen.getByText('Published').className).toContain('text-success');
  });

  it('says a release is withdrawn, in red', () => {
    render(<ReleaseStatusBadge status="withdrawn" />);

    expect(screen.getByText('Withdrawn').className).toContain('text-destructive');
  });

  it('pairs a decorative icon with the word, so the status is never colour alone', () => {
    render(<ReleaseStatusBadge status="withdrawn" />);

    expect(screen.getByText('Withdrawn').querySelector('svg')?.getAttribute('aria-hidden')).toBe(
      'true',
    );
  });

  it('takes other wording', () => {
    render(<ReleaseStatusBadge status="published" messages={{ published: 'Imechapishwa' }} />);

    expect(screen.getByText('Imechapishwa')).toBeTruthy();
  });

  it('has a word for every status of the contract’s OpenDataRelease, and only those', () => {
    const contract = parse(
      readFileSync(
        createRequire(import.meta.url).resolve('@adili/schemas/internal/reporting.yaml'),
        'utf8',
      ),
    ) as {
      components: {
        schemas: { OpenDataRelease: { properties: { status: { enum: string[] } } } };
      };
    };

    expect([...RELEASE_STATUSES]).toEqual(
      contract.components.schemas.OpenDataRelease.properties.status.enum,
    );
  });
});
