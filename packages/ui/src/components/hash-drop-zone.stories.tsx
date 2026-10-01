import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';

import { HashDropZone } from './hash-drop-zone';

// A stand-in for the issued slip, and its SHA-256 as the verification API returns it.
const ISSUED =
  '%PDF-1.7\n% Adili Online acknowledgement slip DCI-TSC-2026-0012345-8, version 2\n%%EOF\n';
const ISSUED_SHA256 = 'f045701b0daa22b501b046d42bd5d9d5d6b3482f48b371e285a2c9a3e09eaca3';

const meta = {
  title: 'Verification/HashDropZone',
  component: HashDropZone,
  args: { expectedSha256: ISSUED_SHA256, onChecked: fn() },
  decorators: [
    (Story) => (
      <div className="max-w-[560px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HashDropZone>;

export default meta;
type Story = StoryObj<typeof meta>;

async function choose(canvasElement: HTMLElement, file: File) {
  const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
  if (input) await userEvent.upload(input, file, { applyAccept: false });
  await within(canvasElement).findByRole('button', { name: 'Check another file' });
}

export const Idle: Story = {};

/** The file given is byte for byte the issued document. */
export const Identical: Story = {
  play: async ({ canvasElement }) => {
    await choose(canvasElement, new File([ISSUED], 'acknowledgement-slip-v2.pdf'));
  },
};

/** One character edited: the digest no longer matches. Technical details open. */
export const DoesNotMatch: Story = {
  play: async ({ canvasElement }) => {
    const edited = ISSUED.replace('version 2', 'version 3');
    await choose(canvasElement, new File([edited], 'acknowledgement-slip (edited).pdf'));
    await userEvent.click(
      within(canvasElement).getByRole('button', { name: 'Show technical details' }),
    );
  },
};

/** Not a PDF, or damaged. */
export const CouldNotRead: Story = {
  play: async ({ canvasElement }) => {
    await choose(canvasElement, new File(['Payslip September 2026'], 'payslip.docx'));
  },
};

/** A file whose bytes never finish reading, so the zone stays on "Checking". */
class HeldFile extends File {
  override arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise(() => undefined);
  }
}

/** The file is being read and hashed on the device. */
export const Checking: Story = {
  play: async ({ canvasElement }) => {
    const input = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (input) {
      await userEvent.upload(input, new HeldFile([ISSUED], 'acknowledgement-slip-v2.pdf'), {
        applyAccept: false,
      });
    }
    await within(canvasElement).findByText('Checking the file on your device');
  },
};

/** No Web Crypto, as on a page served over plain http: the file cannot be checked here. */
export const Unavailable: Story = {
  beforeEach: () => {
    // Shadows the prototype's getter until the story unmounts.
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true });
    return () => {
      Reflect.deleteProperty(globalThis.crypto, 'subtle');
    };
  },
  play: async ({ canvasElement }) => {
    await choose(canvasElement, new File([ISSUED], 'acknowledgement-slip-v2.pdf'));
  },
};
