import { Box, Typography } from '@mui/material';
import {
  Datagrid,
  DateField,
  List,
  SelectInput,
  TextField,
  TextInput,
  useRecordContext,
} from 'react-admin';
import { IsoDateTimeInput } from './inputs';

const filters = [
  <TextInput key="username" source="username" alwaysOn />,
  <TextInput key="action" source="action" alwaysOn />,
  <SelectInput
    key="result"
    source="result"
    choices={[
      { id: 'ok', name: 'ok' },
      { id: 'error', name: 'error' },
    ]}
    alwaysOn
  />,
  <IsoDateTimeInput key="from" source="at_gte" label="After" />,
  <IsoDateTimeInput key="to" source="at_lte" label="Before" />,
];

interface AuditRow {
  payload: string | null;
  error: string | null;
  target: string | null;
}

// The request body as it was sent, minus anything matching password/secret/
// token/key — the guard redacts those before the row is written, so what is
// shown here is what is stored.
function Details() {
  const record = useRecordContext<AuditRow>();
  if (!record) return null;
  return (
    <Box sx={{ p: 1 }}>
      {record.error && (
        <Typography variant="body2" color="error.main" gutterBottom>
          {record.error}
        </Typography>
      )}
      <Typography
        variant="body2"
        component="pre"
        sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', m: 0 }}
      >
        {record.payload ?? '(no body)'}
      </Typography>
    </Box>
  );
}

// Read-only by construction: the server has no route that writes or deletes an
// audit row, so there is nothing to build here but a list. Rows include the
// attempts that were refused — a viewer's 403 on "force crash" is exactly what
// this screen exists to show.
export function AuditLogList() {
  return (
    <List
      filters={filters}
      sort={{ field: 'at', order: 'DESC' }}
      exporter={false}
    >
      <Datagrid bulkActionButtons={false} expand={<Details />} rowClick={false}>
        <DateField source="at" showTime />
        <TextField source="username" />
        <TextField source="action" />
        <TextField source="target" />
        <TextField source="result" />
        <TextField source="httpStatus" label="Status" />
      </Datagrid>
    </List>
  );
}
