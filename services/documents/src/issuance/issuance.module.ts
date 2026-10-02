import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { ReviewModule } from '../review/review.module.js';
import { DocumentsController, InternalDocumentsController } from './issuance.controller.js';
import { IssuanceService, VERIFY_BASE_URL } from './issuance.service.js';
import { OpenBao } from './openbao.js';
import { PadesSigner } from './pades.js';
import { RecordSigner } from './record-signer.js';
import { GotenbergRenderer, PdfRenderer } from './renderer.js';

/**
 * Issuance of verifiable documents (ADR-010, spec 06): Gotenberg rendering, PAdES and record
 * signatures through OpenBao, storage in the issued bucket, supersession and owner downloads.
 * A clarification letter's fields are pulled from the review service.
 * Other modules of the service (the acknowledgement consumer) issue through `IssuanceService`.
 */
@Module({
  imports: [ReviewModule],
  controllers: [DocumentsController, InternalDocumentsController],
  providers: [
    IssuanceService,
    { provide: PdfRenderer, useFactory: () => new GotenbergRenderer(config.GOTENBERG_URL) },
    {
      provide: OpenBao,
      useFactory: () => new OpenBao({ url: config.OPENBAO_ADDR, token: config.OPENBAO_TOKEN }),
    },
    { provide: PadesSigner, inject: [OpenBao], useFactory: (bao: OpenBao) => new PadesSigner(bao) },
    {
      provide: RecordSigner,
      inject: [OpenBao],
      useFactory: (bao: OpenBao) => new RecordSigner(bao),
    },
    { provide: VERIFY_BASE_URL, useValue: config.VERIFY_BASE_URL },
  ],
  exports: [IssuanceService],
})
export class IssuanceModule {}
