import { Button, Icon } from '@adili/ui';
import { ArrowLeft01Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';

import { FileBox } from './file-box';
import { messages as m } from './messages';
import type { CleanUpload } from './upload';
import { WizardCard, WizardFoot, WizardSection, WizardTitle } from './wizard-card';
import { PassedScan } from './wizard-upload-step';

/**
 * Step 3 for now: the clean file. The column mapping, row count, "complete roster" choice and
 * "Start import" arrive with the next ticket (#40).
 */
export function WizardCheckStep({ upload, onBack }: { upload: CleanUpload; onBack: () => void }) {
  return (
    <WizardCard>
      <WizardSection className="grid gap-4">
        <WizardTitle>{m.checkTitle}</WizardTitle>
        <FileBox name={upload.fileName} size={upload.size}>
          <PassedScan />
        </FileBox>
        <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Icon icon={InformationCircleIcon} className="size-3.5" />
          {m.checkNotYet}
        </p>
      </WizardSection>
      <WizardFoot>
        <Button variant="secondary" onClick={onBack}>
          <Icon icon={ArrowLeft01Icon} />
          {m.back}
        </Button>
      </WizardFoot>
    </WizardCard>
  );
}
