import { Module } from '@nestjs/common';

import { ProjectionsConsumer } from './projections.consumer.js';

/**
 * The reporting projections (spec 09): inbox consumers of obligation, filing, clarification,
 * action, determination and referral events, building the facts Form M is compiled from.
 */
@Module({ controllers: [ProjectionsConsumer] })
export class ProjectionsModule {}
