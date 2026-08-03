import CasinoIcon from '@mui/icons-material/Casino';
import HistoryIcon from '@mui/icons-material/History';
import PeopleIcon from '@mui/icons-material/People';
import TimelineIcon from '@mui/icons-material/Timeline';
import WalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { Admin, Resource } from 'react-admin';
import { Dashboard } from './Dashboard';
import { LoginPage } from './LoginPage';
import { authProvider } from './authProvider';
import { dataProvider } from './dataProvider';
import { AuditLogList } from './resources/auditLog';
import { BetList, BetShow } from './resources/bets';
import { RoundList, RoundShow } from './resources/rounds';
import { UserCreate, UserEdit, UserList } from './resources/users';
import { WalletOpList, WalletOpShow } from './resources/walletOps';
import { Role } from './types';

// Resource names are the API paths, hyphens and all: ra-data-simple-rest builds
// its URL as `${apiUrl}/${resource}`, so a camelCase name here would ask for
// /api/walletOps and get a 404. The menu labels are set separately.
export function App() {
  return (
    <Admin
      title="Crash Pilot — Backoffice"
      dataProvider={dataProvider}
      authProvider={authProvider}
      loginPage={LoginPage}
      dashboard={Dashboard}
      // Nothing renders — and therefore nothing is fetched — before the session
      // is confirmed. Without it the first paint fires a wave of requests that
      // all 401 while the login page is still loading.
      requireAuth
      // react-admin loads a tracking pixel from marmelab.com on the first run
      // of a production build. The content security policy blocks it, but a
      // console that operates a live casino should not be attempting the
      // request in the first place.
      disableTelemetry
    >
      {(permissions: Role | null) => (
        <>
          <Resource
            name="rounds"
            list={RoundList}
            show={RoundShow}
            icon={TimelineIcon}
          />
          <Resource
            name="bets"
            list={BetList}
            show={BetShow}
            icon={CasinoIcon}
          />
          <Resource
            name="wallet-ops"
            options={{ label: 'Wallet ops' }}
            list={WalletOpList}
            show={WalletOpShow}
            icon={WalletIcon}
          />
          {/* Hidden rather than merely guarded. The server answers 403 either
              way and records the attempt; this just keeps a viewer from
              spending a click to find out. */}
          {permissions === 'admin' && (
            <Resource
              name="users"
              list={UserList}
              create={UserCreate}
              edit={UserEdit}
              icon={PeopleIcon}
              recordRepresentation="username"
            />
          )}
          {permissions === 'admin' && (
            <Resource
              name="audit-log"
              options={{ label: 'Audit log' }}
              list={AuditLogList}
              icon={HistoryIcon}
            />
          )}
        </>
      )}
    </Admin>
  );
}
