import { randomUUID } from 'node:crypto';

import { ok } from '../clients/api.js';
import type { SeedStep } from '../step.js';
import { unchanged } from '../step.js';

/**
 * Platform help articles Ask Adili rests its answers on beside the Act and the Regulations (spec
 * 11), as a platform administrator publishes them. The law says what to declare and that values
 * are approximate; how to arrive at one is practice, which the statutory corpus does not hold. The
 * demo's scripted "How do I value my car?" (#685) is answered from this article, not only from
 * the First Schedule's "approximate value".
 */
export const HELP_ARTICLES = [
  {
    title: 'Valuing your assets: vehicles, land and other property',
    bodyEn: [
      'The form asks for an approximate value of each asset as at the statement date, in Kenya shillings. You do not need a professional valuation: a fair figure, what a buyer would pay for the asset on that date, is enough. Round it.',
      'A vehicle: what vehicles of the same make, model, year and condition sell for. Dealer and online listings, or a recent insurance valuation, are good guides. The price you paid years ago is not its value now.',
      'Land or a building: a recent valuation report if you have one; otherwise what similar plots or houses in the same area sell for.',
      'Shares: the market price on the statement date for listed shares; for a private company, your share of what the company is worth, or what you paid if nothing better is known.',
      'If a value rose or fell by 25% or more since your last declaration, mark the asset "Changed since my last declaration" and explain it.',
    ].join('\n\n'),
    bodySw: null,
    tags: ['statement', 'assets', 'vehicle', 'land', 'building', 'shareholding', 'material-change'],
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    published: true,
  },
] as const;

export const helpArticles: SeedStep = {
  id: 'help-articles',
  title: 'Platform help articles for Ask Adili',
  async run(context) {
    const admin = await context.as('platform-admin');
    const existing = ok(
      await admin.declarations.GET('/v1/help/articles'),
      'platform help articles',
    ).map((article) => article.title);
    let created = 0;
    for (const article of HELP_ARTICLES) {
      if (existing.includes(article.title)) continue;
      ok(
        await admin.declarations.POST('/v1/help/articles', {
          params: { header: { 'Idempotency-Key': randomUUID() } },
          body: { ...article, tags: [...article.tags] },
        }),
        `publish "${article.title}"`,
      );
      created++;
    }
    return created === 0
      ? unchanged(`${String(HELP_ARTICLES.length)} articles`)
      : { changed: created, notes: [`${String(created)} articles published`] };
  },
};
