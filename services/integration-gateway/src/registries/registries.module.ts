import { Module } from '@nestjs/common';

import { AdapterKitModule } from '../adapter-kit/adapter-kit.module.js';
import { config } from '../config.js';
import { ArdhisasaAdapter } from './ardhisasa-adapter.js';
import { BrsDirectorshipsAdapter, SupplierCheckAdapter } from './brs-adapters.js';
import { KraAdapter } from './kra-adapter.js';
import { NtsaAdapter } from './ntsa-adapter.js';
import { RegistriesController } from './registries.controller.js';
import { REGISTRY_URLS, type RegistryUrls } from './registry-urls.js';

/** KRA, NTSA, BRS and ArdhiSasa lookups and the employer-supplier check, on the adapter kit. */
@Module({
  imports: [AdapterKitModule],
  controllers: [RegistriesController],
  providers: [
    KraAdapter,
    NtsaAdapter,
    BrsDirectorshipsAdapter,
    SupplierCheckAdapter,
    ArdhisasaAdapter,
    {
      provide: REGISTRY_URLS,
      useValue: {
        kra: config.KRA_BASE_URL,
        ntsa: config.NTSA_BASE_URL,
        brs: config.BRS_BASE_URL,
        ardhisasa: config.ARDHISASA_BASE_URL,
        hr: config.HR_BASE_URL,
      } satisfies RegistryUrls,
    },
  ],
})
export class RegistriesModule {}
