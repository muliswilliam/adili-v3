import { Module } from '@nestjs/common';

import { config } from '../config.js';
import { EMAIL_SENDER, SMS_SENDER } from './message-sender.js';
import { MessagesController } from './messages.controller.js';
import { MESSAGES_OPTIONS, type MessagesOptions, MessagesService } from './messages.service.js';
import { SmsGatewaySender } from './sms-gateway-sender.js';
import { SmtpSender } from './smtp-sender.js';

/** Templated email and SMS for other services (`/internal/v1/messages`). */
@Module({
  controllers: [MessagesController],
  providers: [
    MessagesService,
    {
      provide: MESSAGES_OPTIONS,
      useValue: {
        providerTimeoutMs: config.PROVIDER_TIMEOUT_MS,
        recipientHashKey: config.RECIPIENT_HASH_KEY,
      } satisfies MessagesOptions,
    },
    {
      provide: EMAIL_SENDER,
      useFactory: () =>
        new SmtpSender({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          from: config.SMTP_FROM,
          timeoutMs: config.PROVIDER_TIMEOUT_MS,
          requireTls: config.SMTP_REQUIRE_TLS,
        }),
    },
    {
      provide: SMS_SENDER,
      useFactory: () =>
        new SmsGatewaySender({ url: config.SMS_GATEWAY_URL, senderId: config.SMS_SENDER_ID }),
    },
  ],
})
export class MessagesModule {}
