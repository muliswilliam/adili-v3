import type {
  ModelProvider,
  ProviderCapabilities,
  ProviderClass,
  StructuredRequest,
  StructuredResult,
} from '../../src/providers/port.js';

const unsupported = () => {
  throw new Error('ScriptedProvider only answers generateStructured');
};

/** A provider whose structured answer is scripted per test, for record mode and executor tests. */
export class ScriptedProvider implements ModelProvider {
  readonly capabilities: ProviderCapabilities = {
    structuredOutput: true,
    streaming: false,
    batch: false,
    promptCaching: false,
    attachments: [],
  };
  readonly requests: StructuredRequest[] = [];

  constructor(
    private readonly answer: (request: StructuredRequest) => Promise<StructuredResult>,
    readonly providerClass: ProviderClass = 'self-hosted',
    readonly name = 'scripted',
  ) {}

  generateStructured(request: StructuredRequest): Promise<StructuredResult> {
    this.requests.push(request);
    return this.answer(request);
  }

  generate = unsupported;
  stream = unsupported;
  submitBatch = unsupported;
  pollBatch = unsupported;
}
