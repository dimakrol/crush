import { defaultDarkTheme, defaultLightTheme, RaThemeOptions } from 'react-admin';

// The console had no theme of its own, so it wore react-admin's stock grey. It
// runs a live casino all shift on one operator's second monitor; it should look
// like a purpose-built control surface, not a scaffold. Two themes, because an
// ops screen that is glanced at in a dark room and one read in daylight are not
// the same screen — react-admin keeps the operator's choice.

// One accent runs through both themes: an indigo/violet for anything the
// operator can act on. Money and health lean on the semantic colours the
// dashboard already speaks — green for settled, amber for waiting, red for
// stuck — so those stay legible against either background.
const BRAND = {
  violet: '#7c6cff',
  violetDark: '#5b4bdb',
  mint: '#22d3a8',
};

// A system stack: the page is served from Nest behind a strict CSP, so a
// web-font request would be blocked and fall back to this anyway. Skipping the
// request keeps the first paint instant and the console offline-clean.
const FONT_STACK = [
  '"Inter"',
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI"',
  'Roboto',
  '"Helvetica Neue"',
  'Arial',
  'sans-serif',
].join(', ');

// Shared shape and type. Kept in one place so the two palettes are the only
// thing that actually differs between light and dark.
const shared = (mode: 'light' | 'dark'): RaThemeOptions => ({
  shape: { borderRadius: 12 },
  typography: {
    fontFamily: FONT_STACK,
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontWeight: 700, letterSpacing: '-0.02em' },
    h4: { fontWeight: 700, letterSpacing: '-0.02em' },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: 'none' },
    overline: { fontWeight: 700, letterSpacing: '0.08em' },
  },
  components: {
    // MUI paints a lighter overlay on every dark elevated surface, which turns
    // a stack of cards into a stack of greys. Flatten it and lean on borders
    // and one deliberate shadow instead.
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          borderRadius: 16,
          border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)'}`,
          boxShadow:
            mode === 'dark'
              ? '0 1px 2px rgba(0,0,0,0.4)'
              : '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
        },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 10, paddingInline: 16 },
        sizeSmall: { borderRadius: 8 },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontWeight: 600, letterSpacing: '0.02em' },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontWeight: 700,
          fontSize: '0.72rem',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: mode === 'dark' ? '#9aa4b8' : '#64748b',
        },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined' },
    },
    MuiOutlinedInput: {
      styleOverrides: { root: { borderRadius: 10 } },
    },
    // react-admin's list card, the frame around every datagrid.
    RaList: {
      styleOverrides: {
        root: {
          '& .RaList-content': {
            borderRadius: 16,
            overflow: 'hidden',
          },
        },
      },
    },
    RaDatagrid: {
      styleOverrides: {
        root: {
          '& .RaDatagrid-headerCell': {
            backgroundColor:
              mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(15,23,42,0.02)',
          },
          '& .RaDatagrid-rowCell': { paddingBlock: 10 },
        },
      },
    },
    RaMenuItemLink: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          marginInline: 8,
          '&.RaMenuItemLink-active': {
            fontWeight: 700,
            backgroundColor:
              mode === 'dark'
                ? 'rgba(124,108,255,0.16)'
                : 'rgba(91,75,219,0.10)',
          },
        },
      },
    },
  },
});

export const lightTheme: RaThemeOptions = {
  ...defaultLightTheme,
  ...shared('light'),
  palette: {
    mode: 'light',
    primary: { main: BRAND.violetDark },
    secondary: { main: BRAND.mint },
    background: { default: '#f5f6fb', paper: '#ffffff' },
    success: { main: '#059669' },
    warning: { main: '#d97706' },
    error: { main: '#dc2626' },
    info: { main: '#2563eb' },
    text: { primary: '#111827', secondary: '#5b6472' },
    divider: 'rgba(15,23,42,0.08)',
  },
  components: {
    ...defaultLightTheme.components,
    ...shared('light').components,
  },
};

export const darkTheme: RaThemeOptions = {
  ...defaultDarkTheme,
  ...shared('dark'),
  palette: {
    mode: 'dark',
    primary: { main: BRAND.violet },
    secondary: { main: BRAND.mint },
    background: { default: '#0b0e15', paper: '#151a24' },
    success: { main: '#34d399' },
    warning: { main: '#fbbf24' },
    error: { main: '#f87171' },
    info: { main: '#60a5fa' },
    text: { primary: '#e7eaf1', secondary: '#98a2b3' },
    divider: 'rgba(255,255,255,0.08)',
  },
  components: {
    ...defaultDarkTheme.components,
    ...shared('dark').components,
  },
};
