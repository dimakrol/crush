import {
  Create,
  CreateProps,
  Datagrid,
  DateField,
  DeleteButton,
  Edit,
  EditProps,
  List,
  PasswordInput,
  required,
  SelectInput,
  SimpleForm,
  TextField,
  TextInput,
  minLength,
} from 'react-admin';
import { choices, ROLES } from '../types';

// Spelled out next to the field, because the role is the only thing standing
// between an account and the money-moving buttons.
const ROLE_HELP =
  'viewer — read only · operator — pause, force crash, retry payouts · admin — the above plus accounts and the audit log';

export function UserList() {
  return (
    <List sort={{ field: 'username', order: 'ASC' }} exporter={false}>
      <Datagrid rowClick="edit" bulkActionButtons={false}>
        <TextField source="username" />
        <TextField source="role" />
        <DateField source="createdAt" showTime />
        <DateField source="updatedAt" showTime />
        {/* The server refuses to delete the last admin or your own account, so
            the button can stay unconditional and say why when it declines. */}
        <DeleteButton mutationMode="pessimistic" />
      </Datagrid>
    </List>
  );
}

export function UserCreate(props: CreateProps) {
  return (
    <Create {...props} redirect="list">
      <SimpleForm>
        <TextInput source="username" validate={[required(), minLength(3)]} />
        <PasswordInput
          source="password"
          validate={[required(), minLength(8)]}
          helperText="At least 8 characters"
        />
        <SelectInput
          source="role"
          choices={choices(ROLES)}
          defaultValue="viewer"
          validate={required()}
          helperText={ROLE_HELP}
        />
      </SimpleForm>
    </Create>
  );
}

export function UserEdit(props: EditProps) {
  return (
    // Pessimistic: an optimistic update would show the role changing a moment
    // before the server refuses to demote the last admin, and the operator
    // would read the refusal as a glitch.
    <Edit {...props} mutationMode="pessimistic" redirect="list">
      <SimpleForm>
        <TextInput source="username" validate={[required(), minLength(3)]} />
        <PasswordInput
          source="password"
          validate={minLength(8)}
          helperText="Leave empty to keep the current password"
          // An untouched field submits '', which the server would reject for
          // being under eight characters. undefined is dropped by
          // JSON.stringify, and absent means "leave it alone".
          parse={(value: string) => value || undefined}
        />
        <SelectInput
          source="role"
          choices={choices(ROLES)}
          validate={required()}
          helperText={ROLE_HELP}
        />
      </SimpleForm>
    </Edit>
  );
}
