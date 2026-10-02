import { startTelemetry } from '@adili/telemetry';
import { SpanKind } from '@opentelemetry/api';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEED, StubRegistries } from './support/stub-registries.js';
import { StubIprs } from './support/stub-iprs.js';
import { createTestApp, type TestApp } from './support/test-app.js';

/** Kiprono's KRA PIN in the planted records: the KRA lookup's second call names it. */
const KIPRONO_PIN = 'A002260778R';

/**
 * #476: registries take a national ID (or a KRA PIN) in the URL path or query, and HTTP
 * auto-instrumentation records every outbound URL on a client span. Through the gateway's HTTP
 * API, with the production telemetry setup exporting to memory, no exported span carries them.
 */
describe('outbound registry spans', () => {
  const spans = new InMemorySpanExporter();
  let sdk: ReturnType<typeof startTelemetry>;
  let registries: StubRegistries;
  let iprs: StubIprs;
  let t: TestApp;
  let review: Record<string, string>;
  let directory: Record<string, string>;

  beforeAll(async () => {
    // The SDK batches spans for 5s; export each batch at once, so a test waits milliseconds.
    vi.stubEnv('OTEL_BSP_SCHEDULE_DELAY', '10');
    sdk = startTelemetry({ serviceName: 'integration-gateway', traceExporter: spans });
    registries = await StubRegistries.start();
    iprs = await StubIprs.start();
    t = await createTestApp({ registryUrls: registries.urls, baseUrl: iprs.baseUrl });
    t.app.useLogger(false);
    review = {
      authorization: `Bearer ${await t.token({ clientId: 'review', scope: 'registry' })}`,
      'x-acting-tenant': 'psc',
      'x-legal-basis': 'regs-r20-1-b',
      'x-case-ref': 'case-0001',
    };
    directory = { authorization: `Bearer ${await t.token()}` };
    return async () => {
      await t.close();
      await iprs.close();
      await registries.close();
      await sdk.shutdown();
      vi.unstubAllEnvs();
    };
  });

  beforeEach(async () => {
    registries.reset();
    iprs.reset();
    await t.clearCache();
    spans.reset();
  });

  /**
   * Every exported span, as the trace store would receive it, once the registry `calls` are among
   * the exported client spans (the spans of the registries' side end before them).
   */
  const exported = async (calls: RegExp[]) => {
    await vi.waitFor(() => {
      const urls = spans
        .getFinishedSpans()
        .filter((span) => span.kind === SpanKind.CLIENT)
        .map((span) => span.attributes['url.full']);
      for (const call of calls) expect(urls).toContainEqual(expect.stringMatching(call));
    });
    return JSON.stringify(
      spans.getFinishedSpans().map((span) => ({
        name: span.name,
        kind: span.kind,
        attributes: span.attributes,
        events: span.events.map(({ name, attributes }) => ({ name, attributes })),
        status: span.status,
      })),
    );
  };

  it.each([
    {
      system: 'KRA',
      path: 'kra/taxpayer-lookups',
      calls: [/\/kra\/v1\/pins\?id_number=/, /\/kra\/v1\/pins\/[^/]+\/compliance$/],
    },
    {
      system: 'NTSA',
      path: 'ntsa/vehicle-lookups',
      calls: [/\/ntsa\/v1\/owners\/[^/]+\/vehicles$/],
    },
    {
      system: 'BRS',
      path: 'brs/directorship-lookups',
      calls: [/\/brs\/v1\/persons\/[^/]+\/directorships$/],
    },
    {
      system: 'ArdhiSasa',
      path: 'ardhisasa/parcel-lookups',
      calls: [/\/ardhisasa\/v1\/owners\/[^/]+\/parcels$/],
    },
  ])('the $system lookup exports no national ID or KRA PIN', async ({ path, calls }) => {
    const response = await t.app.inject({
      method: 'POST',
      url: `/internal/v1/${path}`,
      headers: review,
      payload: { nationalId: SEED.kiprono },
    });
    expect(response.statusCode).toBe(200);

    const text = await exported(calls);
    expect(text).not.toContain(SEED.kiprono);
    expect(text).not.toContain(KIPRONO_PIN);
  });

  it('the IPRS lookup exports no national ID', async () => {
    iprs.people.set(SEED.kiprono, {
      id_number: SEED.kiprono,
      first_name: 'Kiprono',
      last_name: 'Chebet',
      date_of_birth: '1979-08-21',
      sex: 'M',
      place_of_birth: 'Eldoret',
      date_of_issue: '1998-02-10',
    });
    const response = await t.app.inject({
      method: 'POST',
      url: '/internal/v1/iprs/person-lookups',
      headers: directory,
      payload: { nationalId: SEED.kiprono },
    });
    expect(response.statusCode).toBe(200);

    const text = await exported([/\/v1\/persons\/[^/]+$/]);
    expect(text).not.toContain(SEED.kiprono);
  });
});
