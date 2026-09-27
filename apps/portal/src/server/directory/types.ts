import type { components } from './schema.gen';

type Schemas = components['schemas'];

export type IdentifyDeclarant = Schemas['IdentifyDeclarant'];
export type OnboardingCommission = Schemas['OnboardingCommission'];
export type OnboardingProblem = Schemas['OnboardingProblem'];
export type OnboardingProblemCode = OnboardingProblem['code'];
export type OnboardingSession = Schemas['OnboardingSession'];
export type OnboardingSessionCreated = Schemas['OnboardingSessionCreated'];
export type OnboardingState = Schemas['OnboardingState'];
export type OtpChannel = Schemas['OtpChannel'];
export type DeclarantProfile = Schemas['DeclarantProfile'];
