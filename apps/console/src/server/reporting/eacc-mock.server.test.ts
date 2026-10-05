import { describe, expect, it, vi } from 'vitest';

// The dev server's REPORTING_MOCK_TODAY, which the store seeds from on its first read.
vi.mock('../env.server', () => ({ env: () => ({ REPORTING_MOCK_TODAY: '2026-10-03' }) }));

describe('the EACC intake mock loaded on its own', () => {
  it('seeds the shared store itself, so its PDFs and receipts download first thing (F17)', async () => {
    // A fresh module graph: as when a download is the dev server's first reporting request,
    // before the Form M workspace mock has loaded.
    vi.resetModules();
    const { mockEaccIntakeFileTitle } = await import('./eacc-mock.server');
    // Bungoma (0), Kiambu (2) and Kirinyaga (3) filed FY 2025's report by today.
    const titles = [0, 2, 3].map((index) =>
      mockEaccIntakeFileTitle(`0199c200-0000-7000-8000-2025${String(index).padStart(8, '0')}`),
    );
    expect(titles).toEqual([
      'Form M RPT-CPSB039-2026-0000001-K.pdf',
      'Form M RPT-CPSB022-2026-0000001-K.pdf',
      'Form M RPT-CPSB020-2026-0000001-K.pdf',
    ]);
  });
});
