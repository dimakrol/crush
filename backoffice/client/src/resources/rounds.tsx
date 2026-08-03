import {
  Datagrid,
  DateField,
  List,
  NumberField,
  Show,
  ShowProps,
  SelectInput,
  SimpleShowLayout,
  TabbedShowLayout,
  TextField,
  TextInput,
  ReferenceManyField,
} from 'react-admin';
import { IsoDateTimeInput, YES_NO } from './inputs';
import { choices, ROUND_PHASES } from '../types';

const filters = [
  <TextInput key="id" source="id" label="Round id" alwaysOn />,
  <SelectInput
    key="phase"
    source="phase"
    choices={choices(ROUND_PHASES)}
    alwaysOn
  />,
  // The question the forced_at column exists to answer: which rounds did an
  // operator end by hand?
  <SelectInput key="forced" source="forced" label="Forced" choices={YES_NO} />,
  <IsoDateTimeInput key="from" source="createdAt_gte" label="Created after" />,
  <IsoDateTimeInput key="to" source="createdAt_lte" label="Created before" />,
];

export function RoundList() {
  return (
    <List
      filters={filters}
      sort={{ field: 'createdAt', order: 'DESC' }}
      exporter={false}
    >
      {/* Nothing here is writable — the rows belong to the platform and this
          service reads them through a role that cannot write. */}
      <Datagrid rowClick="show" bulkActionButtons={false}>
        <DateField source="createdAt" showTime />
        <TextField source="phase" />
        <NumberField
          source="crashPoint"
          options={{ maximumFractionDigits: 2 }}
        />
        <DateField source="startedAt" showTime />
        <DateField source="crashedAt" showTime />
        <DateField source="forcedAt" label="Forced at" showTime />
        <TextField source="id" />
      </Datagrid>
    </List>
  );
}

export function RoundShow(props: ShowProps) {
  return (
    <Show {...props}>
      <TabbedShowLayout>
        <TabbedShowLayout.Tab label="Round">
          <SimpleShowLayout>
            <TextField source="id" />
            <TextField source="phase" />
            <NumberField source="crashPoint" />
            <DateField source="createdAt" showTime />
            <DateField source="startedAt" showTime />
            <DateField source="crashedAt" showTime />
            {/* Set only for a hand-crashed round, and never cleared. Who did it
                is in the audit log, not here — the platform keeps the fact, the
                console keeps the name. */}
            <DateField source="forcedAt" label="Forced at" showTime />
          </SimpleShowLayout>
        </TabbedShowLayout.Tab>

        {/* Fetched only when the tab is opened, which is why the round route
            does not embed them: most views of a round never ask. */}
        <TabbedShowLayout.Tab label="Bets" path="bets">
          <ReferenceManyField
            reference="bets"
            target="roundId"
            label={false}
            sort={{ field: 'placedAt', order: 'ASC' }}
          >
            <Datagrid rowClick="show" bulkActionButtons={false}>
              <TextField source="userId" label="Player" />
              <TextField source="slotId" label="Slot" />
              <NumberField source="amount" />
              <TextField source="status" />
              <NumberField source="cashOutMultiplier" label="Cashed out at" />
              <NumberField source="payout" />
            </Datagrid>
          </ReferenceManyField>
        </TabbedShowLayout.Tab>

        <TabbedShowLayout.Tab label="Wallet ops" path="wallet-ops">
          <ReferenceManyField
            reference="wallet-ops"
            target="roundId"
            label={false}
            sort={{ field: 'createdAt', order: 'ASC' }}
          >
            <Datagrid rowClick="show" bulkActionButtons={false}>
              <DateField source="createdAt" showTime />
              <TextField source="kind" />
              <TextField source="state" />
              <TextField source="playerId" label="Player" />
              <NumberField source="amount" />
              <TextField source="attempts" />
            </Datagrid>
          </ReferenceManyField>
        </TabbedShowLayout.Tab>
      </TabbedShowLayout>
    </Show>
  );
}
