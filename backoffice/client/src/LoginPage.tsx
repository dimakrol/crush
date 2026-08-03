import { FormEvent, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Notification, useLogin, useNotify } from 'react-admin';

// react-admin's stock login page is fine; this one exists to say what the
// console is. An operator who has three tabs open needs the title to tell them
// which system they are about to pause.
export function LoginPage() {
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
        bgcolor: 'background.default',
      }}
    >
      <Card sx={{ width: 380, maxWidth: '90vw' }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Crash Pilot — Backoffice
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Operator sign-in
          </Typography>
          <form onSubmit={submit}>
            <Stack spacing={2} sx={{ mt: 2 }}>
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
                disabled={busy || !username || !password}
                fullWidth
              >
                {busy ? <CircularProgress size={20} /> : 'Sign in'}
              </Button>
            </Stack>
          </form>
        </CardContent>
      </Card>
      <Notification />
    </Box>
  );
}
