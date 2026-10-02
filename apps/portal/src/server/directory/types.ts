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

export type StartApplicantOnboarding = Schemas['StartApplicantOnboarding'];
export type ApplicantOnboardingSession = Schemas['ApplicantOnboardingSession'];
export type ApplicantOnboardingSessionCreated = Schemas['ApplicantOnboardingSessionCreated'];
export type ApplicantOnboardingState = Schemas['ApplicantOnboardingState'];
export type ApplicantOnboardingProblem = Schemas['ApplicantOnboardingProblem'];
export type ApplicantOnboardingProblemCode = ApplicantOnboardingProblem['code'];
export type IdentityDocumentKind = Schemas['IdentityDocumentKind'];
