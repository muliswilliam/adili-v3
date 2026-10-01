import { IssuanceDependencyUnavailable } from './errors.js';

/** HTML to PDF (ADR-010 step 1). */
export abstract class PdfRenderer {
  /** A4 PDF of `html` with `footer` repeated at the foot of every page. */
  abstract render(html: string, footer: string): Promise<Buffer>;
}

/** A4 with the prototype's margins; the bottom margin holds the verification footer. */
const PAGE = {
  paperWidth: '8.27',
  paperHeight: '11.69',
  marginTop: '0.55',
  marginBottom: '1.2',
  marginLeft: '0.71',
  marginRight: '0.71',
};

/**
 * Gotenberg's Chromium route (self-hosted, Apache 2.0). Rendering a page takes a second or two;
 * the budget covers a cold Chromium.
 */
export class GotenbergRenderer extends PdfRenderer {
  constructor(
    private readonly url: string,
    private readonly timeoutMs = 20_000,
  ) {
    super();
  }

  async render(html: string, footer: string): Promise<Buffer> {
    const form = new FormData();
    form.append('files', new Blob([html], { type: 'text/html' }), 'index.html');
    form.append('files', new Blob([footer], { type: 'text/html' }), 'footer.html');
    for (const [name, value] of Object.entries(PAGE)) form.append(name, value);
    form.append('printBackground', 'true');
    // A template that loads anything from outside fails instead of rendering without it.
    form.append('failOnResourceLoadingFailed', 'true');
    let response: Response;
    try {
      response = await fetch(`${this.url.replace(/\/+$/, '')}/forms/chromium/convert/html`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new IssuanceDependencyUnavailable('renderer', 'Gotenberg did not answer', {
        cause: error,
      });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new IssuanceDependencyUnavailable('renderer', `Gotenberg answered ${response.status}`);
    }
    const pdf = Buffer.from(await response.arrayBuffer());
    if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new IssuanceDependencyUnavailable('renderer', 'Gotenberg returned something not a PDF');
    }
    return pdf;
  }
}
