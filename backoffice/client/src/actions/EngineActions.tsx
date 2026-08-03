import BoltIcon from '@mui/icons-material/Bolt';
import PauseIcon from '@mui/icons-material/PauseCircle';
import PlayIcon from '@mui/icons-material/PlayCircle';
import { useDataProvider } from 'react-admin';
import { ActionButton } from './ActionButton';
import { BackofficeDataProvider } from '../dataProvider';
import { EngineState } from '../types';

interface EngineActionProps {
  engine: EngineState | null;
  onDone: () => void;
}

// Pausing is graceful: the round on screen finishes and settles, only the next
// one is withheld. Saying so in the dialog is the difference between an
// operator who pauses to investigate and one who is afraid to touch it.
export function PauseToggle({ engine, onDone }: EngineActionProps) {
  const dataProvider = useDataProvider<BackofficeDataProvider>();
  const paused = engine?.paused ?? false;

  return (
    <ActionButton
      label={paused ? 'Resume rounds' : 'Pause rounds'}
      startIcon={paused ? <PlayIcon /> : <PauseIcon />}
      color={paused ? 'success' : 'warning'}
      // Unknown engine state means the platform is unreachable; the request
      // would fail with 502 and tell the operator nothing they cannot already
      // see on the card above.
      disabled={engine === null}
      confirmTitle={paused ? 'Resume rounds?' : 'Pause rounds?'}
      confirmContent={
        paused
          ? 'The next round will start as usual. Players can bet again.'
          : 'The current round finishes and settles normally; no new round starts after it. Players see a "rounds paused" notice and cannot bet.'
      }
      run={async () => {
        const state = await dataProvider.setEnginePaused(!paused);
        return state.paused ? 'Rounds paused' : 'Rounds resumed';
      }}
      onDone={onDone}
    />
  );
}

// Only offered while a round is actually running. The platform refuses
// otherwise with a 409 the operator would have to read and understand; not
// offering the button is a better way to say the same thing.
export function ForceCrashButton({ engine, onDone }: EngineActionProps) {
  const dataProvider = useDataProvider<BackofficeDataProvider>();
  const running = engine?.phase === 'RUNNING';

  return (
    <ActionButton
      label="Force crash"
      startIcon={<BoltIcon />}
      color="error"
      disabled={!running}
      confirmTitle="Crash the current round now?"
      confirmContent={
        <>
          Round {engine?.roundId ?? '—'} ends at roughly&nbsp;
          {engine?.multiplier?.toFixed(2) ?? '—'}×. Everyone still in loses;
          everyone who cashed out keeps their payout. The round is marked as
          forced permanently, and this entry names you in the audit log.
        </>
      }
      run={async () => {
        const { roundId } = await dataProvider.forceCrash();
        return `Round ${roundId} crashed`;
      }}
      onDone={onDone}
    />
  );
}
