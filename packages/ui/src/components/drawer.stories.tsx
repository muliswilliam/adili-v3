import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Button } from './button';
import { DescriptionItem, DescriptionList } from './description-list';
import {
  Drawer,
  DrawerBody,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer';
import { ReminderHistory } from './reminder-history';
import { StatusBadge } from './status-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowLink,
} from './table';

const meta = {
  title: 'Obligations/Drawer',
  component: Drawer,
} satisfies Meta<typeof Drawer>;

export default meta;
type Story = StoryObj<typeof meta>;

function ObligationDetail() {
  return (
    <>
      <DrawerHeader>
        <DrawerTitle>Amina Njeri Odhiambo</DrawerTitle>
        <DrawerDescription>Biennial declaration 2027</DrawerDescription>
      </DrawerHeader>
      <DrawerBody>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge variant="warning">Overdue</StatusBadge>
          <span className="text-sm font-semibold text-warning-subtle-foreground">
            3 days overdue
          </span>
        </div>
        <DescriptionList>
          <DescriptionItem term="File number">
            <span className="font-mono">PSC/2019/00417</span>
          </DescriptionItem>
          <DescriptionItem term="Commission">Public Service Commission</DescriptionItem>
          <DescriptionItem term="Statement date">1 Nov 2027</DescriptionItem>
          <DescriptionItem term="Due date">31 Dec 2027</DescriptionItem>
        </DescriptionList>
        <ReminderHistory
          reminders={[
            {
              offsetDays: 30,
              scheduledAt: '2027-12-01T09:14:00.000Z',
              sentAt: '2027-12-01T09:14:06.000Z',
              channels: ['sms', 'email'],
              outcome: 'sent',
            },
            {
              offsetDays: 14,
              scheduledAt: '2027-12-17T09:14:00.000Z',
              sentAt: '2027-12-17T09:14:04.000Z',
              channels: ['sms', 'email'],
              outcome: 'sent',
            },
          ]}
        />
      </DrawerBody>
      <DrawerFooter>
        <Button variant="secondary">Roster record</Button>
        <DrawerClose asChild>
          <Button variant="ghost">Close</Button>
        </DrawerClose>
      </DrawerFooter>
    </>
  );
}

export const Closed: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="secondary">Open an obligation</Button>
      </DrawerTrigger>
      <DrawerContent>
        <ObligationDetail />
      </DrawerContent>
    </Drawer>
  ),
};

export const Open: Story = {
  render: () => (
    <Drawer defaultOpen>
      <DrawerTrigger asChild>
        <Button variant="secondary">Open an obligation</Button>
      </DrawerTrigger>
      <DrawerContent>
        <ObligationDetail />
      </DrawerContent>
    </Drawer>
  ),
};

export const Wide: Story = {
  render: () => (
    <Drawer defaultOpen>
      <DrawerTrigger asChild>
        <Button variant="secondary">Open an obligation</Button>
      </DrawerTrigger>
      <DrawerContent size="wide">
        <ObligationDetail />
      </DrawerContent>
    </Drawer>
  ),
};

/** Opened from a row link with no DrawerTrigger; closing returns focus to the link. */
export const FromARow: Story = {
  render: function FromARow() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Table caption="Declarants and their obligations">
          <TableHeader>
            <TableRow>
              <TableHead>Declarant</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <TableRowLink
                  href="#o-1"
                  onClick={(event) => {
                    event.preventDefault();
                    setOpen(true);
                  }}
                >
                  Amina Njeri Odhiambo
                </TableRowLink>
              </TableCell>
              <TableCell>
                <StatusBadge variant="warning">Overdue</StatusBadge>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent>
            <ObligationDetail />
          </DrawerContent>
        </Drawer>
      </>
    );
  },
};
