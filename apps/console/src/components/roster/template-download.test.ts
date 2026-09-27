import { describe, expect, it, vi } from 'vitest';

import {
  attachmentFileName,
  downloadRosterTemplate,
  isRosterTemplateFormat,
  rosterTemplateUrl,
} from './template-download';

describe('attachmentFileName', () => {
  it('reads quoted and bare file names', () => {
    expect(attachmentFileName('attachment; filename="adili-roster-template.xlsx"', 'x')).toBe(
      'adili-roster-template.xlsx',
    );
    expect(attachmentFileName('attachment; filename=roster.csv', 'x')).toBe('roster.csv');
  });

  it('falls back without a file name', () => {
    expect(attachmentFileName(null, 'fallback.csv')).toBe('fallback.csv');
    expect(attachmentFileName('attachment', 'fallback.csv')).toBe('fallback.csv');
  });
});

describe('isRosterTemplateFormat', () => {
  it('accepts csv and xlsx only', () => {
    expect(isRosterTemplateFormat('csv')).toBe(true);
    expect(isRosterTemplateFormat('xlsx')).toBe(true);
    expect(isRosterTemplateFormat('pdf')).toBe(false);
    expect(isRosterTemplateFormat(null)).toBe(false);
  });
});

describe('downloadRosterTemplate', () => {
  const xlsx = () =>
    new Response(new Uint8Array([0x50, 0x4b]), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename="adili-roster-template.xlsx"',
      },
    });

  it('fetches the console route and saves the file under its attachment name', async () => {
    const fetch = vi.fn(() => Promise.resolve(xlsx()));
    const save = vi.fn();

    await expect(downloadRosterTemplate('xlsx', { fetch, save })).resolves.toBe('saved');

    expect(fetch).toHaveBeenCalledWith(rosterTemplateUrl('xlsx'));
    expect(rosterTemplateUrl('xlsx')).toBe('/roster/template?format=xlsx');
    expect(save).toHaveBeenCalledTimes(1);
    const [file, fileName] = save.mock.calls[0] as [Blob, string];
    expect(fileName).toBe('adili-roster-template.xlsx');
    expect(file.size).toBe(2);
  });

  it('reports a signed-out user without saving', async () => {
    const save = vi.fn();
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 401 })));

    await expect(downloadRosterTemplate('csv', { fetch, save })).resolves.toBe('unauthenticated');
    expect(save).not.toHaveBeenCalled();
  });

  it.each([
    ['a 403', () => Promise.resolve(new Response(null, { status: 403 }))],
    ['a 502', () => Promise.resolve(new Response(null, { status: 502 }))],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('reports %s as failed without saving', async (_case, respond) => {
    const save = vi.fn();

    await expect(downloadRosterTemplate('csv', { fetch: vi.fn(respond), save })).resolves.toBe(
      'failed',
    );
    expect(save).not.toHaveBeenCalled();
  });
});
