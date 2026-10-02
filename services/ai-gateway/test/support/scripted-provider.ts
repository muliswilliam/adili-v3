import type {
  GenerateRequest,
  GenerateResult,
  ModelProvider,
  ProviderCapabilities,
  ProviderClass,
  StructuredRequest,
  StreamEvent,
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

/** One scripted stream: text chunks, then how it ends (a result, or a thrown error). */
export interface StreamScript {
  chunks: string[];
  end: { status: 'completed' | 'truncated' } | { status: 'refused' } | { error: Error };
  /** Waits before each chunk, so a test can act mid-stream. */
  beforeChunk?: (index: number) => Promise<void>;
}

/** A provider whose streams are scripted per call, in order; the last script repeats. */
export class ScriptedStreamProvider implements ModelProvider {
  readonly capabilities: ProviderCapabilities = {
    structuredOutput: true,
    streaming: true,
    batch: false,
    promptCaching: false,
    attachments: [],
  };
  readonly requests: GenerateRequest[] = [];
  scripts: StreamScript[] = [];

  constructor(
    readonly providerClass: ProviderClass = 'external',
    readonly name = 'scripted',
  ) {}

  async *stream(request: GenerateRequest): AsyncIterable<StreamEvent> {
    this.requests.push(request);
    const script = this.scripts.length > 1 ? this.scripts.shift() : this.scripts[0];
    if (!script) throw new Error('No stream scripted');
    for (const [index, chunk] of script.chunks.entries()) {
      await script.beforeChunk?.(index);
      yield { type: 'delta', text: chunk };
    }
    const { end } = script;
    if ('error' in end) throw end.error;
    const result: GenerateResult =
      end.status === 'refused'
        ? {
            status: 'refused',
            refusal: { category: null, explanation: null },
            model: 'm',
            usage: USAGE,
          }
        : {
            status: end.status,
            text: script.chunks.join(''),
            model: 'claude-opus-5-5',
            usage: USAGE,
          };
    yield { type: 'final', result };
  }

  generateStructured = unsupported;
  generate = unsupported;
  submitBatch = unsupported;
  pollBatch = unsupported;
}

const USAGE = { inputTokens: 900, outputTokens: 120, cacheReadTokens: 0, cacheWriteTokens: 0 };
