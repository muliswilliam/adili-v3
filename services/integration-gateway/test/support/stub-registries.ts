import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { RegistryUrls } from '../../src/registries/registry-urls.js';

/** The registries the stub serves, as their paths start (`/<registry>/v1/...`). */
export type StubRegistry = keyof RegistryUrls;

/** What one stub registry does with the next requests. */
export type StubRegistryBehaviour = { kind: 'registry' } | { kind: 'status'; status: number };

/**
 * The planted demo records (mocks/demo/seed.py, REGISTRY_FLAGS.md) in the registries' own shapes
 * (packages/schemas/external), so these tests and the demo agree.
 */
export const SEED = {
  wanjiku: '27451863',
  peter: '24718355',
  /** A child with IPRS records only: no PIN, vehicles, parcels or companies. */
  imani: '40731125',
  kiprono: '22607781',
  /** Nobody any registry knows. */
  unknown: '99999999',
} as const;

const TAXPAYERS = [
  {
    pin: 'A004518637K',
    id_number: SEED.wanjiku,
    name: 'WANJIKU NJOKI KAMAU',
    registered_on: '2006-03-01',
    compliance: {
      status: 'compliant',
      certificate_number: `TCC${SEED.wanjiku}`,
      valid_until: '2027-06-30',
      annual_income_declared: '3120000.00',
    },
  },
  {
    pin: 'A002471835M',
    id_number: SEED.peter,
    name: 'PETER MWANGI KAMAU',
    registered_on: '2003-03-01',
    compliance: {
      status: 'compliant',
      certificate_number: `TCC${SEED.peter}`,
      valid_until: '2027-06-30',
      annual_income_declared: '1860000.00',
    },
  },
  {
    pin: 'A002260778R',
    id_number: SEED.kiprono,
    name: 'KIPRONO KIBET CHEBET',
    registered_on: '2001-03-01',
    compliance: {
      status: 'non_compliant',
      certificate_number: '',
      valid_until: null,
      annual_income_declared: '2640000.00',
    },
  },
];

const VEHICLES = [
  ['KCX 214J', 'Toyota', 'Fielder', 2016, SEED.wanjiku, '2019-05-12'],
  ['KDK 482M', 'Toyota', 'Land Cruiser Prado', 2023, SEED.wanjiku, '2024-11-04'],
  ['KCB 903T', 'Mazda', 'CX-5', 2014, SEED.peter, '2017-02-20'],
  ['KDA 118Q', 'Nissan', 'X-Trail', 2019, SEED.kiprono, '2021-07-30'],
].map(([registration, make, model, year, owner, registeredOn]) => ({
  registration_number: registration,
  make,
  model,
  year_of_manufacture: year,
  owner_id_number: owner,
  registered_on: registeredOn,
}));

const PARCELS = [
  ['KIAMBU/RUIRU EAST BLOCK 2/4417', 'Kiambu', '0.0450', 'freehold', SEED.wanjiku, '2014-09-03'],
  ['KAJIADO/KITENGELA/59821', 'Kajiado', '2.0235', 'freehold', SEED.wanjiku, '2025-01-17'],
  ['NAIROBI/BLOCK 82/1934', 'Nairobi', '0.0930', 'leasehold', SEED.kiprono, '2010-06-11'],
].map(([parcel, county, hectares, tenure, owner, registeredOn]) => ({
  parcel_number: parcel,
  county,
  area_hectares: hectares,
  tenure,
  owner_id_number: owner,
  registered_on: registeredOn,
}));

const AFYA_BORA = {
  company_registration_number: 'PVT-9XYZ2L4Q',
  company_name: 'Afya Bora Medical Supplies Limited',
  company_status: 'active',
};
const DIRECTORSHIPS = [
  { ...AFYA_BORA, id: SEED.wanjiku, role: 'director_shareholder', shares: 400 },
  { ...AFYA_BORA, id: SEED.peter, role: 'director_shareholder', shares: 600 },
  {
    company_registration_number: 'PVT-3KLM8R2T',
    company_name: 'Rift Valley Agrovet Limited',
    company_status: 'active',
    id: SEED.kiprono,
    role: 'shareholder',
    shares: 250,
    appointed_on: '2015-08-03',
  },
].map(({ id, ...directorship }) => [id, { appointed_on: '2022-02-14', ...directorship }] as const);

const SUPPLIERS: Record<string, string[]> = { KEMSA: ['PVT-9XYZ2L4Q'] };

/**
 * An HTTP stand-in for the KRA, NTSA, BRS, ArdhiSasa and HR mocks, serving the planted demo
 * records in the mocks' shapes. Counts requests per registry and fails on demand, so tests can
 * tell cache hits from calls.
 */
export class StubRegistries {
  readonly calls: Record<StubRegistry, number> = { kra: 0, ntsa: 0, brs: 0, ardhisasa: 0, hr: 0 };
  readonly behaviour: Record<StubRegistry, StubRegistryBehaviour> = {
    kra: { kind: 'registry' },
    ntsa: { kind: 'registry' },
    brs: { kind: 'registry' },
    ardhisasa: { kind: 'registry' },
    hr: { kind: 'registry' },
  };
  private readonly server: Server;

  private constructor() {
    this.server = createServer((request, response) => {
      this.handle(request, response);
    });
  }

  static async start(): Promise<StubRegistries> {
    const stub = new StubRegistries();
    stub.server.listen(0, '127.0.0.1');
    await once(stub.server, 'listening');
    return stub;
  }

  get urls(): RegistryUrls {
    const { port } = this.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${String(port)}`;
    return {
      kra: `${base}/kra`,
      ntsa: `${base}/ntsa`,
      brs: `${base}/brs`,
      ardhisasa: `${base}/ardhisasa`,
      hr: `${base}/hr`,
    };
  }

  reset(): void {
    for (const registry of Object.keys(this.calls) as StubRegistry[]) {
      this.calls[registry] = 0;
      this.behaviour[registry] = { kind: 'registry' };
    }
  }

  async close(): Promise<void> {
    this.server.closeAllConnections();
    this.server.close();
    await once(this.server, 'close');
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const url = new URL(request.url ?? '/', 'http://stub');
    const registry = url.pathname.split('/')[1] as StubRegistry;
    if (!(registry in this.calls)) {
      send(response, 404, { detail: 'Not found.' });
      return;
    }
    this.calls[registry] += 1;
    const behaviour = this.behaviour[registry];
    if (behaviour.kind === 'status') {
      send(response, behaviour.status, { title: 'Injected', status: behaviour.status });
      return;
    }
    const path = url.pathname
      .slice(registry.length + 1)
      .split('/')
      .map(decodeURIComponent);
    const body = answer(registry, path, url.searchParams);
    if (body === undefined) send(response, 404, { detail: 'No record matches.' });
    else send(response, 200, body);
  }
}

/** The mock's answer to `/<registry>/<path...>`, or undefined for a 404. */
function answer(registry: StubRegistry, path: string[], query: URLSearchParams): unknown {
  const [, version, resource, key, sub] = path;
  if (version !== 'v1') return undefined;
  switch (registry) {
    case 'kra': {
      if (resource !== 'pins') return undefined;
      if (key === undefined) {
        return TAXPAYERS.filter((t) => t.id_number === query.get('id_number')).map((t) => ({
          pin: t.pin,
          id_number: t.id_number,
          name: t.name,
          registered_on: t.registered_on,
        }));
      }
      const taxpayer = TAXPAYERS.find((t) => t.pin === key);
      if (!taxpayer) return undefined;
      return sub === 'compliance' ? { pin: taxpayer.pin, ...taxpayer.compliance } : undefined;
    }
    case 'ntsa':
      return resource === 'owners' && sub === 'vehicles'
        ? VEHICLES.filter((v) => v.owner_id_number === key)
        : undefined;
    case 'ardhisasa':
      return resource === 'owners' && sub === 'parcels'
        ? PARCELS.filter((p) => p.owner_id_number === key)
        : undefined;
    case 'brs':
      return resource === 'persons' && sub === 'directorships'
        ? DIRECTORSHIPS.filter(([id]) => id === key).map(([, directorship]) => directorship)
        : undefined;
    case 'hr':
      return resource === 'employers' && sub === 'suppliers' && key !== undefined
        ? { employer_code: key, registration_numbers: SUPPLIERS[key] ?? [] }
        : undefined;
  }
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}
