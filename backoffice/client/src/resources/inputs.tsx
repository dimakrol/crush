import { DateTimeInput, DateTimeInputProps } from 'react-admin';

// The server parses date filters with `new Date(value)`, and the container runs
// in UTC. A raw <DateTimeInput> submits "2026-08-01T18:00" with no zone, so an
// operator in UTC+3 would silently be asking about a different three hours than
// the one they picked. Normalising to an absolute instant in the browser, where
// the local zone is actually known, is the only place this can be got right.
export function IsoDateTimeInput(props: DateTimeInputProps) {
  return (
    <DateTimeInput
      {...props}
      parse={(value: string) =>
        value ? new Date(value).toISOString() : undefined
      }
    />
  );
}

// Presence filters (rounds.forcedAt) take true/false. As strings, because that
// is what a select puts in the query string either way, and the server accepts
// both spellings.
export const YES_NO = [
  { id: 'true', name: 'Yes' },
  { id: 'false', name: 'No' },
];
