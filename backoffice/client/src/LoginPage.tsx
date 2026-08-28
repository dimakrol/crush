import { FormEvent, useState } from 'react';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { Notification, useLogin, useNotify } from 'react-admin';

// react-admin's stock login page is fine; this one exists to say what the
// console is. An operator who has three tabs open needs the title to tell them
// which system they are about to pause.
export function LoginPage() {
  const theme = useTheme();
  const login = useLogin();
  const notify = useNotify();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    login({ username, password })
      .catch((error: unknown) => {
        // The server answers the same "Invalid username or password" whichever
        // half was wrong, and that message is what reaches here.
        notify(error instanceof Error ? error.message : 'Sign-in failed', {
          type: 'error',
        });
      })
      .finally(() => setBusy(false));
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
        bgcolor: 'background.default',
        // A dark control-surface backdrop: two faint accent glows over the base
        // so the sign-in card sits on something, not on flat grey.
        backgroundImage: `radial-gradient(60rem 60rem at 15% -10%, ${theme.palette.primary.main}22, transparent 60%), radial-gradient(50rem 50rem at 110% 110%, ${theme.palette.secondary.main}1f, transparent 55%)`,
      }}
    >
      <Card sx={{ width: 400, maxWidth: '92vw' }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={1.5} sx={{ alignItems: 'center', mb: 3 }}>
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 52,
                height: 52,
                borderRadius: 3,
                color: '#fff',
                background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
                boxShadow: `0 8px 24px ${theme.palette.primary.main}44`,
              }}
            >
              <RocketLaunchIcon />
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 700 }}>
              Crash Pilot
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Operator sign-in
            </Typography>
          </Stack>

          <form onSubmit={submit}>
            <Stack spacing={2}>
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                autoComplete="username"
                fullWidth
              />
              <TextField
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                fullWidth
              />
              <Button
                type="submit"
                variant="contained"
                size="large"
                disabled={busy || !username || !password}
                fullWidth
                sx={{ mt: 1 }}
              >
                {busy ? <CircularProgress size={22} color="inherit" /> : 'Sign in'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
      <Notification />
    </Box>
  );
}
