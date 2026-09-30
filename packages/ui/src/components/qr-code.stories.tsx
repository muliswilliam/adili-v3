import type { Meta, StoryObj } from '@storybook/react-vite';

import { QrCode } from './qr-code';

const CODE = 'ADL-7Q4K-M2XR-9HTC';

const meta = {
  title: 'Verification/QrCode',
  component: QrCode,
  args: {
    value: `https://verify.adili.go.ke/v/${CODE}`,
    label: `QR code for verification code ${CODE}`,
  },
} satisfies Meta<typeof QrCode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = { args: { size: 64 } };

/** As on the slip card: the code is always printed as text beside it too. */
export const WithCode: Story = {
  render: (args) => (
    <div className="flex items-center gap-4">
      <QrCode {...args} size={124} className="shadow-card" />
      <div>
        <div className="text-[13px] text-muted-foreground">Verification code</div>
        <div className="font-mono font-semibold">{CODE}</div>
      </div>
    </div>
  ),
};
