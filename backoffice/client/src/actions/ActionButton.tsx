import { ReactNode, useState } from 'react';
import { Button, ButtonProps } from '@mui/material';
import { Confirm, useNotify, usePermissions } from 'react-admin';
import { Role } from '../types';

// Who may change anything. A viewer's buttons are not disabled but absent: a
// greyed-out "Force crash" invites a support ticket, and the server would
// answer 403 anyway — the audit log has the proof of that from phase 4.
export function useCanAct(): boolean {
  const { permissions } = usePermissions<Role>();
  return permissions === 'operator' || permissions === 'admin';
}

interface ActionButtonProps {
  label: string;
  confirmTitle: string;
  confirmContent: ReactNode;
  // Returns the line to show on success — usually something the operator can
  // check against, like the id of the round that was crashed.
  run: () => Promise<string>;
  onDone?: () => void;
  disabled?: boolean;
  startIcon?: ReactNode;
  color?: ButtonProps['color'];
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
}

// Every action in this console is irreversible in the way that matters: a
// crashed round cannot be un-crashed, and a retried payout may already have
// moved money. So none of them fire on a single click, and each one says in the
// dialog what it is about to do rather than asking "Are you sure?".
export function ActionButton({
  label,
  confirmTitle,
  confirmContent,
  run,
  onDone,
  disabled,
  startIcon,
  color = 'primary',
  variant = 'outlined',
  size = 'medium',
}: ActionButtonProps) {
  const notify = useNotify();
  const canAct = useCanAct();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canAct) return null;

  const confirm = () => {
    setBusy(true);
    run()
      .then((message) => {
        notify(message, { type: 'success' });
        onDone?.();
      })
      .catch((error: unknown) => {
        // Includes the platform's own refusals, passed through with its text:
        // "No running round to crash (phase is CRASHED)" is the answer, not a
        // failure of the console.
        notify(error instanceof Error ? error.message : 'Action failed', {
          type: 'error',
        });
      })
      .finally(() => {
        setBusy(false);
        setOpen(false);
      });
  };

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={disabled || busy}
        startIcon={startIcon}
        color={color}
        variant={variant}
        size={size}
      >
        {label}
      </Button>
      <Confirm
        isOpen={open}
        loading={busy}
        title={confirmTitle}
        content={confirmContent}
        confirm={label}
        cancel="Cancel"
        onConfirm={confirm}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
