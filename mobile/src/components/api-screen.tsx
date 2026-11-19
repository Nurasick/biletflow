import type { PropsWithChildren } from 'react';

import { Action, Info, WorkspaceScreen } from '@/components/workspace';

export function Screen({ title, children, onBack }: PropsWithChildren<{ title: string; onBack?: () => void }>) {
  return <WorkspaceScreen title={title} onBack={onBack}>{children}</WorkspaceScreen>;
}

export const Label = Info;

export function Button({ title, onPress, disabled, secondary }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean;
}) {
  return <Action label={title} onPress={onPress} disabled={disabled} secondary={secondary} />;
}
