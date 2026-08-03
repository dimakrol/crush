import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
} from '@mui/material';
import { Link, Title, useDataProvider } from 'react-admin';
import { ForceCrashButton, PauseToggle } from './actions/EngineActions';
import { BackofficeDataProvider } from './dataProvider';
import { DashboardData } from './types';

// Slow enough not to hammer two databases, fast enough that an operator who
// just clicked "pause" sees it take effect. Polling and not a socket on
// purpose: the platform's socket gateway speaks to players, and giving the
// console a second live channel into the engine would be a second thing to keep
// correct for a screen that can afford to be two seconds late.
const POLL_MS = 2500;

export function Dashboard() {
  const dataProvider = useDataProvider<BackofficeDataProvider>();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const next = await dataProvider.getDashboard();
      if (!mounted.current) return;
      setData(next);
      setError(null);
    } catch (err) {
      if (!mounted.current) return;
      // The dashboard route itself failing is a different thing from the
      // platform being unreachable — that one comes back inside a 200 as
      // engineError, with the counters still filled in.
      setError(err instanceof Error ? err.message : 'Could not load status');
    }
  }, [dataProvider]);

  useEffect(() => {
    mounted.current = true;
    void load();
    // A backgrounded tab is not being watched by anyone, and this screen is the
    // one an operator leaves open all shift.
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, POLL_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(id);
    };
  }, [load]);

  if (!data && !error) {
    return (
      <Box sx={{ p: 4 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  const cutoff = data
    ? new Date(Date.now() - data.stuckAfterMinutes * 60_000).toISOString()
    : null;

  return (
    <Box sx={{ p: 2 }}>
      <Title title="Dashboard" />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {data && (
        <>
          <EngineCard data={data} onDone={load} />

          <Typography variant="overline" color="text.secondary">
            Needs attention
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              mt: 1,
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            }}
          >
            <Counter
              label="Wallet ops failed"
              value={data.counters.walletOpsFailed}
              hint="Terminal: retried until the budget ran out"
              to={listLink('wallet-ops', { state: 'FAILED' })}
            />
            <Counter
              label={`Wallet ops pending > ${data.stuckAfterMinutes}m`}
              value={data.counters.walletOpsStuckPending}
              hint="Still in the outbox, not yet confirmed"
              to={listLink('wallet-ops', {
                state: 'PENDING',
                createdAt_lte: cutoff,
              })}
            />
            <Counter
              label="Bets awaiting settlement"
              value={data.counters.betsSettlementPending}
              hint="Won, payout not confirmed by the operator"
              to={listLink('bets', { status: 'SETTLEMENT_PENDING' })}
            />
            <Counter
              label={`Stakes pending > ${data.stuckAfterMinutes}m`}
              value={data.counters.betsStuckPendingStake}
              hint="Debit sent, no answer — neither placed nor refused"
              to={listLink('bets', {
                status: 'PENDING_STAKE',
                placedAt_lte: cutoff,
              })}
            />
          </Box>
        </>
      )}
    </Box>
  );
}

function EngineCard({
  data,
  onDone,
}: {
  data: DashboardData;
  onDone: () => void;
}) {
  const { engine, engineError } = data;

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="overline" color="text.secondary">
          Engine
        </Typography>

        {engineError && (
          <Alert severity="warning" sx={{ my: 1 }}>
            {engineError} — the counters below still come from the database.
          </Alert>
        )}

        <Stack
          direction="row"
          spacing={3}
          useFlexGap
          sx={{ my: 1, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Chip
            label={engine?.paused ? 'PAUSED' : (engine?.phase ?? 'UNKNOWN')}
            color={
              engine?.paused
                ? 'warning'
                : engine?.phase === 'RUNNING'
                  ? 'success'
                  : engine
                    ? 'default'
                    : 'error'
            }
          />
          <Field label="Multiplier">
            {engine?.multiplier != null
              ? `${engine.multiplier.toFixed(2)}×`
              : '—'}
          </Field>
          <Field label="Round">
            {engine?.roundId ? (
              <Link to={`/rounds/${engine.roundId}/show`}>
                {engine.roundId}
              </Link>
            ) : (
              '—'
            )}
          </Field>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          sx={{ mt: 2, flexWrap: 'wrap' }}
        >
          <PauseToggle engine={engine} onDone={onDone} />
          <ForceCrashButton engine={engine} onDone={onDone} />
        </Stack>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block' }}
      >
        {label}
      </Typography>
      <Typography variant="body2" component="div">
        {children}
      </Typography>
    </Box>
  );
}

function Counter({
  label,
  value,
  hint,
  to,
}: {
  label: string;
  value: number;
  hint: string;
  to: string;
}) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="caption" color="text.secondary">
          {label}
        </Typography>
        <Typography
          variant="h4"
          color={value > 0 ? 'error.main' : 'text.primary'}
        >
          {/* A count with no way to see what it counts is a number to worry
              about rather than one to act on. */}
          <Link to={to}>{value}</Link>
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      </CardContent>
    </Card>
  );
}

// The same filter vocabulary the list screens use, so the link lands on a list
// the operator can then widen or narrow by hand.
function listLink(
  resource: string,
  filter: Record<string, string | null>,
): string {
  const clean = Object.fromEntries(
    Object.entries(filter).filter(([, v]) => v !== null),
  );
  return `/${resource}?filter=${encodeURIComponent(JSON.stringify(clean))}`;
}
