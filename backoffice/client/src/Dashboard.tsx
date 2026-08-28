import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import BoltIcon from '@mui/icons-material/Bolt';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PaymentsIcon from '@mui/icons-material/Payments';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography,
  alpha,
  useTheme,
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
      <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  const cutoff = data
    ? new Date(Date.now() - data.stuckAfterMinutes * 60_000).toISOString()
    : null;

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1200, mx: 'auto' }}>
      <Title title="Dashboard" />

      <Stack
        direction="row"
        sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 3 }}
      >
        <Box>
          <Typography variant="h4">Control room</Typography>
          <Typography variant="body2" color="text.secondary">
            Live engine status and everything waiting on a human.
          </Typography>
        </Box>
        <LivePulse />
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2, borderRadius: 3 }}>
          {error}
        </Alert>
      )}

      {data && (
        <>
          <EngineCard data={data} onDone={load} />

          <Typography
            variant="overline"
            color="text.secondary"
            sx={{ mt: 4, mb: 1, display: 'block' }}
          >
            Needs attention
          </Typography>
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            }}
          >
            <Counter
              label="Wallet ops failed"
              value={data.counters.walletOpsFailed}
              hint="Terminal: retried until the budget ran out"
              icon={<WarningAmberIcon />}
              color="error"
              to={listLink('wallet-ops', { state: 'FAILED' })}
            />
            <Counter
              label={`Wallet ops pending > ${data.stuckAfterMinutes}m`}
              value={data.counters.walletOpsStuckPending}
              hint="Still in the outbox, not yet confirmed"
              icon={<HourglassEmptyIcon />}
              color="warning"
              to={listLink('wallet-ops', {
                state: 'PENDING',
                createdAt_lte: cutoff,
              })}
            />
            <Counter
              label="Bets awaiting settlement"
              value={data.counters.betsSettlementPending}
              hint="Won, payout not confirmed by the operator"
              icon={<PaymentsIcon />}
              color="warning"
              to={listLink('bets', { status: 'SETTLEMENT_PENDING' })}
            />
            <Counter
              label={`Stakes pending > ${data.stuckAfterMinutes}m`}
              value={data.counters.betsStuckPendingStake}
              hint="Debit sent, no answer — neither placed nor refused"
              icon={<HourglassEmptyIcon />}
              color="warning"
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

// A quiet "this is live" marker, so a screen left open all shift reads as
// polling rather than frozen.
function LivePulse() {
  const theme = useTheme();
  const ring = alpha(theme.palette.success.main, 0.5);
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Box
        sx={{
          width: 9,
          height: 9,
          borderRadius: '50%',
          bgcolor: 'success.main',
          animation: 'bo-pulse 2s ease-out infinite',
          '@keyframes bo-pulse': {
            '0%': { boxShadow: `0 0 0 0 ${ring}` },
            '70%': { boxShadow: `0 0 0 7px ${alpha(ring, 0)}` },
            '100%': { boxShadow: `0 0 0 0 ${alpha(ring, 0)}` },
          },
        }}
      />
      <Typography variant="caption" color="text.secondary">
        Live
      </Typography>
    </Stack>
  );
}

function EngineCard({
  data,
  onDone,
}: {
  data: DashboardData;
  onDone: () => void;
}) {
  const theme = useTheme();
  const { engine, engineError } = data;

  const running = !engine?.paused && engine?.phase === 'RUNNING';
  const accent = engine?.paused
    ? theme.palette.warning.main
    : running
      ? theme.palette.success.main
      : engine
        ? theme.palette.text.secondary
        : theme.palette.error.main;

  return (
    <Card
      sx={{
        overflow: 'hidden',
        background: `linear-gradient(135deg, ${alpha(accent, 0.12)} 0%, ${alpha(
          theme.palette.background.paper,
          0,
        )} 60%)`,
        borderColor: alpha(accent, 0.35),
      }}
    >
      <Box sx={{ height: 3, bgcolor: accent }} />
      <CardContent sx={{ p: 3 }}>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
        >
          <Typography variant="overline" color="text.secondary">
            Engine
          </Typography>
          <Chip
            size="small"
            label={engine?.paused ? 'PAUSED' : (engine?.phase ?? 'UNKNOWN')}
            color={
              engine?.paused
                ? 'warning'
                : running
                  ? 'success'
                  : engine
                    ? 'default'
                    : 'error'
            }
          />
        </Stack>

        {engineError && (
          <Alert severity="warning" sx={{ mb: 2, borderRadius: 3 }}>
            {engineError} — the counters below still come from the database.
          </Alert>
        )}

        <Stack
          direction="row"
          spacing={5}
          useFlexGap
          sx={{ alignItems: 'flex-end', flexWrap: 'wrap', mb: 3 }}
        >
          <Box>
            <Typography variant="caption" color="text.secondary">
              Multiplier
            </Typography>
            <Typography
              variant="h3"
              sx={{
                fontVariantNumeric: 'tabular-nums',
                color: running ? 'success.main' : 'text.primary',
                lineHeight: 1.1,
              }}
            >
              {engine?.multiplier != null
                ? `${engine.multiplier.toFixed(2)}×`
                : '—'}
            </Typography>
          </Box>
          <Field label="Current round">
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
          spacing={1.5}
          useFlexGap
          sx={{ flexWrap: 'wrap' }}
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
      <Typography variant="body1" component="div" sx={{ fontWeight: 600 }}>
        {children}
      </Typography>
    </Box>
  );
}

function Counter({
  label,
  value,
  hint,
  icon,
  color,
  to,
}: {
  label: string;
  value: number;
  hint: string;
  icon: ReactNode;
  color: 'error' | 'warning';
  to: string;
}) {
  const active = value > 0;
  return (
    <Card
      component={Link}
      to={to}
      sx={{
        display: 'block',
        textDecoration: 'none',
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        borderColor: (t) =>
          active ? alpha(t.palette[color].main, 0.4) : undefined,
        '&:hover': {
          transform: 'translateY(-2px)',
          boxShadow: (t) =>
            `0 8px 24px ${alpha(t.palette.common.black, t.palette.mode === 'dark' ? 0.4 : 0.12)}`,
        },
      }}
    >
      <CardContent>
        <Stack
          direction="row"
          sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
        >
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          <Box
            sx={{
              display: 'flex',
              color: (t) =>
                active ? t.palette[color].main : t.palette.text.disabled,
            }}
          >
            {icon}
          </Box>
        </Stack>
        <Typography
          variant="h3"
          sx={{
            fontVariantNumeric: 'tabular-nums',
            color: active ? `${color}.main` : 'text.primary',
          }}
        >
          {value}
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
