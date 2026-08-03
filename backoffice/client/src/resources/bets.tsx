import {
  Datagrid,
  DateField,
  List,
  NumberField,
  NumberInput,
  ReferenceField,
  ReferenceManyField,
  SelectInput,
  Show,
  ShowProps,
  SimpleShowLayout,
  TabbedShowLayout,
  TextField,
  TextInput,
} from 'react-admin';
import { IsoDateTimeInput } from './inputs';
import { BET_STATUSES, choices } from '../types';

const filters = [
  <TextInput key="userId" source="userId" label="Player id" alwaysOn />,
  <SelectInput
    key="status"
    source="status"
    choices={choices(BET_STATUSES)}
    alwaysOn
  />,
  <TextInput key="roundId" source="roundId" label="Round id" />,
  <NumberInput key="slotId" source="slotId" label="Slot" min={1} max={2} />,
  <TextInput key="currency" source="currency" />,
  <IsoDateTimeInput key="from" source="placedAt_gte" label="Placed after" />,
  <IsoDateTimeInput key="to" source="placedAt_lte" label="Placed before" />,
];

// amount and payout are Postgres numeric; the server converts them to numbers
// at the edge so these can be right-aligned and summed like the money they are.
export function BetList() {
  return (
    <List
      filters={filters}
      sort={{ field: 'placedAt', order: 'DESC' }}
      exporter={false}
    >
      <Datagrid rowClick="show" bulkActionButtons={false}>
        <DateField source="placedAt" showTime />
        <TextField source="userId" label="Player" />
        <ReferenceField source="roundId" reference="rounds" link="show">
          <DateField source="createdAt" showTime />
        </ReferenceField>
        <TextField source="slotId" label="Slot" />
        <NumberField source="amount" />
        <TextField source="currency" />
        <TextField source="status" />
        <NumberField source="cashOutMultiplier" label="Cashed out at" />
        <NumberField source="payout" />
      </Datagrid>
    </List>
  );
}

export function BetShow(props: ShowProps) {
  return (
    <Show {...props}>
      <TabbedShowLayout>
        <TabbedShowLayout.Tab label="Bet">
          <SimpleShowLayout>
            <TextField source="id" />
            <TextField source="userId" label="Player" />
            <ReferenceField source="roundId" reference="rounds" link="show">
              <TextField source="id" />
            </ReferenceField>
            <TextField source="slotId" label="Slot" />
            <NumberField source="amount" />
            <TextField source="currency" />
            <NumberField source="autoCashOut" label="Auto cash-out" />
            <TextField source="status" />
            <NumberField source="cashOutMultiplier" label="Cashed out at" />
            <NumberField source="payout" />
            <DateField source="placedAt" showTime />
            <DateField source="cashedOutAt" showTime />
            <DateField source="resolvedAt" showTime />
          </SimpleShowLayout>
        </TabbedShowLayout.Tab>

        {/* Where the money actually went. A bet stuck in PENDING_STAKE or
            SETTLEMENT_PENDING is a question about its outbox rows, so this tab
            is the first place to look and one click away. */}
        <TabbedShowLayout.Tab label="Wallet ops" path="wallet-ops">
          <ReferenceManyField
            reference="wallet-ops"
            target="betId"
            label={false}
            sort={{ field: 'createdAt', order: 'ASC' }}
          >
            <Datagrid rowClick="show" bulkActionButtons={false}>
              <DateField source="createdAt" showTime />
              <TextField source="kind" />
              <TextField source="state" />
              <TextField source="txRef" />
              <NumberField source="amount" />
              <TextField source="attempts" />
              <TextField source="lastError" />
            </Datagrid>
          </ReferenceManyField>
        </TabbedShowLayout.Tab>
      </TabbedShowLayout>
    </Show>
  );
}
