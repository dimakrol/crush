import { ReactNode } from 'react';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import { Box, Typography, useTheme } from '@mui/material';
import {
  AppBar,
  Layout as RaLayout,
  LayoutProps,
  TitlePortal,
  ToggleThemeButton,
  UserMenu,
} from 'react-admin';

// The wordmark that sits in the app bar in place of react-admin's bare title.
// An operator with three consoles open needs the one they are about to pause to
// name itself; the rocket is the crash game's own motif.
function Brand() {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 30,
          height: 30,
          borderRadius: 2,
          color: '#fff',
          background: `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
        }}
      >
        <RocketLaunchIcon sx={{ fontSize: 18 }} />
      </Box>
      <Typography
        variant="h6"
        sx={{ fontWeight: 700, letterSpacing: '-0.01em', lineHeight: 1 }}
      >
        Crash&nbsp;Pilot
      </Typography>
      <Typography
        variant="caption"
        sx={{
          ml: 0.5,
          px: 0.75,
          py: 0.25,
          borderRadius: 1,
          fontWeight: 700,
          letterSpacing: '0.06em',
          color: 'text.secondary',
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        BACKOFFICE
      </Typography>
    </Box>
  );
}

function BackofficeAppBar() {
  return (
    <AppBar
      color="default"
      userMenu={<UserMenu />}
      toolbar={<ToggleThemeButton />}
    >
      <Brand />
      <TitlePortal />
    </AppBar>
  );
}

export function Layout({ children }: LayoutProps): ReactNode {
  return <RaLayout appBar={BackofficeAppBar}>{children}</RaLayout>;
}
