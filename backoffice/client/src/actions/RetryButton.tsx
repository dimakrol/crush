import ReplayIcon from '@mui/icons-material/Replay';
import { useDataProvider, useRefresh } from 'react-admin';
import { ActionButton } from './ActionButton';
import { BackofficeDataProvider } from '../dataProvider';

interface RetryButtonProps {
  // Omitted for the "everything that failed" form.
  txRef?: string;
  variant?: 'text' | 'outlined' | 'contained';
  size?: 'small' | 'medium';
  onDone?: () => void;
}

// Retrying is safe in the sense that matters — the platform keys every money
// move by an idempotent txRef, so a replay the operator already confirmed is a
// no-op on their side. That is exactly why the two forms are separated: "retry
// this stuck payout" and "retry everything that failed while the operator was
// down" are the same call and completely different decisions.
export function RetryButton({
  txRef,
  variant = 'outlined',
  size = 'medium',
  onDone,
}: RetryButtonProps) {
  const dataProvider = useDataProvider<BackofficeDataProvider>();
  const refresh = useRefresh();

  return (
    <ActionButton
      label={txRef ? 'Retry this op' : 'Retry all failed'}
      startIcon={<ReplayIcon />}
      variant={variant}
      size={size}
      confirmTitle={txRef ? 'Retry this wallet op?' : 'Retry every failed op?'}
      confirmContent={
        txRef ? (
          <>
            {txRef} goes back into the outbox and the worker calls the operator
            again. The call is idempotent, so a move that already went through
            is not repeated.
          </>
        ) : (
          'Every FAILED op is queued again, oldest first. Each call is idempotent, but this can be a lot of money moving at once — check the list first.'
        )
      }
      run={async () => {
        const { retried } = await dataProvider.retryWalletOps(txRef);
        return retried === 1
          ? '1 op queued again'
          : `${retried} ops queued again`;
      }}
      onDone={() => {
        refresh();
        onDone?.();
      }}
    />
  );
}
