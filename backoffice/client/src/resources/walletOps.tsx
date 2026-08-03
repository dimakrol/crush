import {
  Datagrid,
  DateField,
  FilterButton,
  List,
  NumberField,
  ReferenceField,
  SelectInput,
  Show,
  ShowProps,
  SimpleShowLayout,
  TextField,
  TextInput,
  TopToolbar,
  useRecordContext,
} from 'react-admin';
import { RetryButton } from '../actions/RetryButton';
import { IsoDateTimeInput } from './inputs';
import { choices, WALLET_OP_KINDS, WALLET_OP_STATES } from '../types';

const filters = [
  <SelectInput
    key="state"
    source="state"
    choices={choices(WALLET_OP_STATES)}
    alwaysOn
  />,
  <SelectInput
    key="kind"
    source="kind"
    choices={choices(WALLET_OP_KINDS)}
    alwaysOn
  />,
  <TextInput key="txRef" source="txRef" label="Tx ref" />,
  <TextInput key="playerId" source="playerId" label="Player id" />,
  <TextInput key="betId" source="betId" label="Bet id" />,
  <TextInput key="roundId" source="roundId" label="Round id" />,
  <IsoDateTimeInput key="from" source="createdAt_gte" label="Created after" />,
  <IsoDateTimeInput key="to" source="createdAt_lte" label="Created before" />,
];

function ListActions() {
  return (
    <TopToolbar>
      <FilterButton />
      {/* "Everything that failed", the shape of the problem after an operator
          outage. Per-op retry lives in the record below. */}
      <RetryButton variant="text" size="small" />
    </TopToolbar>
  );
}

export function WalletOpList() {
  return (
    <List
      filters={filters}
      actions={<ListActions />}
      sort={{ field: 'createdAt', order: 'DESC' }}
      // No export: the server caps a list at 500 rows, and an export button
      // that quietly stops there is worse than no export button.
      exporter={false}
    >
      <Datagrid rowClick="show" bulkActionButtons={false}>
        <DateField source="createdAt" showTime />
        <TextField source="kind" />
        <TextField source="state" />
        <TextField source="txRef" label="Tx ref" />
        <TextField source="playerId" label="Player" />
        <NumberField source="amount" />
        <TextField source="currency" />
        <TextField source="attempts" />
        <DateField source="nextAttemptAt" label="Next attempt" showTime />
        <TextField source="lastError" label="Last error" />
      </Datagrid>
    </List>
  );
}

// Retrying anything but a FAILED op is not a decision an operator should be
// offered: PENDING is already the worker's job and CONFIRMED is done.
function RetryThisOp() {
  const record = useRecordContext<{ state: string; txRef: string }>();
  if (!record || record.state !== 'FAILED') return null;
  return <RetryButton txRef={record.txRef} />;
}

function ShowActions() {
  return (
    <TopToolbar>
      <RetryThisOp />
    </TopToolbar>
  );
}

export function WalletOpShow(props: ShowProps) {
  return (
    <Show {...props} actions={<ShowActions />}>
      <SimpleShowLayout>
        <TextField source="id" />
        <TextField source="kind" />
        <TextField source="state" />
        <TextField source="txRef" label="Tx ref" />
        {/* Set for ROLLBACK only: the debit this one reverses. */}
        <TextField source="refTxRef" label="Reverses" />
        <ReferenceField source="betId" reference="bets" link="show">
          <TextField source="id" />
        </ReferenceField>
        <ReferenceField source="roundId" reference="rounds" link="show">
          <TextField source="id" />
        </ReferenceField>
        <TextField source="playerId" label="Player" />
        <NumberField source="amount" />
        <TextField source="currency" />
        <TextField source="attempts" />
        <DateField source="nextAttemptAt" label="Next attempt" showTime />
        <TextField source="lastError" label="Last error" />
        <DateField source="createdAt" showTime />
        <DateField source="updatedAt" showTime />
      </SimpleShowLayout>
    </Show>
  );
}
