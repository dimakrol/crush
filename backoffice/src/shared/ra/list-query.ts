import {
  and,
  asc,
  Column,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  SQL,
} from 'drizzle-orm';
import { AppError } from '../errors/AppError';
import { ErrorCode } from '../errors/error-codes';

// The `ra-data-simple-rest` contract, server side.
//
// react-admin sends `?filter={json}&range=[start,end]&sort=["field","ORDER"]`
// and reads the total out of a `Content-Range` header. Both the sort field and
// every filter key are attacker-controlled strings that would otherwise be
// spliced into SQL, so nothing here is generic: a resource declares exactly
// which columns may be sorted on and exactly how each filter maps to a
// condition. An unknown key is a 400, never a silent no-op — a filter the server
// quietly ignores shows the operator a list that is wrong in the one way they
// asked it not to be.
//
// What this file does NOT do is run the query: the platform tables are Postgres
// and the console's own tables are SQLite, and the two dialects have different
// builder types. Everything dialect-independent — parsing, whitelisting,
// building `where`/`order by` as plain `SQL` — lives here; the four lines that
// execute stay in each controller, typed against their own database.

export interface ListSpec {
  // Name used in the Content-Range header. react-admin ignores it, humans
  // reading a network log do not.
  resource: string;
  sortable: Record<string, Column>;
  defaultSort: { field: string; order: 'ASC' | 'DESC' };
  filters: Record<string, (value: unknown) => SQL>;
  // Hard cap on rows per request, whatever range was asked for.
  maxRange?: number;
}

export interface ParsedList {
  where: SQL | undefined;
  orderBy: SQL;
  start: number;
  limit: number;
}

const DEFAULT_MAX_RANGE = 500;

function badRequest(message: string): never {
  throw new AppError(400, ErrorCode.VALIDATION_ERROR, message);
}

function parseJsonParam(raw: unknown, name: string): unknown {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string') badRequest(`${name} must be a JSON string`);
  try {
    return JSON.parse(raw);
  } catch {
    return badRequest(`${name} is not valid JSON`);
  }
}

export function parseListQuery(
  query: Record<string, unknown>,
  spec: ListSpec,
): ParsedList {
  const maxRange = spec.maxRange ?? DEFAULT_MAX_RANGE;

  // ── range ──
  let start = 0;
  let limit = maxRange;
  const range = parseJsonParam(query.range, 'range');
  if (range !== undefined) {
    if (
      !Array.isArray(range) ||
      range.length !== 2 ||
      !range.every((n) => Number.isInteger(n))
    ) {
      badRequest('range must be [start, end] with integer bounds');
    }
    const [from, to] = range as [number, number];
    if (from < 0 || to < from) badRequest('range bounds are out of order');
    start = from;
    limit = Math.min(to - from + 1, maxRange);
  }

  // ── sort ──
  let sortField = spec.defaultSort.field;
  let sortOrder = spec.defaultSort.order;
  const sort = parseJsonParam(query.sort, 'sort');
  if (sort !== undefined) {
    if (!Array.isArray(sort) || sort.length !== 2) {
      badRequest('sort must be ["field", "ASC"|"DESC"]');
    }
    const [field, order] = sort as [unknown, unknown];
    if (typeof field !== 'string' || !(field in spec.sortable)) {
      badRequest(
        `Cannot sort by "${String(field)}"; allowed: ${Object.keys(spec.sortable).join(', ')}`,
      );
    }
    const upper = String(order).toUpperCase();
    if (upper !== 'ASC' && upper !== 'DESC') {
      badRequest('sort order must be ASC or DESC');
    }
    sortField = field;
    sortOrder = upper;
  }
  const column = spec.sortable[sortField];
  const orderBy = sortOrder === 'ASC' ? asc(column) : desc(column);

  // ── filter ──
  const conditions: SQL[] = [];
  const filter = parseJsonParam(query.filter, 'filter');
  if (filter !== undefined) {
    if (
      typeof filter !== 'object' ||
      filter === null ||
      Array.isArray(filter)
    ) {
      badRequest('filter must be a JSON object');
    }
    for (const [key, value] of Object.entries(
      filter as Record<string, unknown>,
    )) {
      // react-admin drops empty filter inputs by sending '' rather than
      // removing the key; treat that as "not filtering" instead of matching
      // rows whose column is the empty string.
      if (value === undefined || value === null || value === '') continue;
      const build = spec.filters[key];
      if (!build) {
        badRequest(
          `Unknown filter "${key}"; allowed: ${Object.keys(spec.filters).join(', ')}`,
        );
      }
      conditions.push(build(value));
    }
  }

  return {
    where: conditions.length ? and(...conditions) : undefined,
    orderBy,
    start,
    limit,
  };
}

// `<resource> <start>-<end>/<total>`. react-admin only reads the total, but the
// range is what makes a paging bug obvious in a network log.
export function contentRange(
  resource: string,
  start: number,
  rowCount: number,
  total: number,
): string {
  const end = rowCount > 0 ? start + rowCount - 1 : start;
  return `${resource} ${start}-${end}/${total}`;
}

// ── Filter builders ───────────────────────────────────────────────────────
// Each one is responsible for validating its own input: by the time a value
// reaches a comparison it must be the right shape, or the operator gets a 400
// naming the field rather than a 500 from the driver.

function asStringArray(value: unknown, field: string): string[] {
  const list = Array.isArray(value) ? value : [value];
  if (!list.length) badRequest(`${field} filter cannot be empty`);
  return list.map((v) => {
    if (typeof v !== 'string' && typeof v !== 'number') {
      badRequest(`${field} filter must be a string or a list of strings`);
    }
    return String(v);
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Postgres rejects a malformed uuid with a driver error, which would surface as
// a 500 for what is really a bad request. Checked before the value gets near a
// query, on both the :id routes and the uuid filters.
export function assertUuid(value: string, field = 'id'): string {
  if (!UUID_RE.test(value)) badRequest(`${field} is not a valid id`);
  return value;
}

// Equality on a text/uuid column, accepting a list — react-admin's getMany
// fetches related records as filter={"id":["…","…"]}.
export function stringFilter(column: Column, field: string) {
  return (value: unknown): SQL => {
    const list = asStringArray(value, field);
    return list.length === 1 ? eq(column, list[0]) : inArray(column, list);
  };
}

// Same, for a uuid column.
export function uuidFilter(column: Column, field: string) {
  return (value: unknown): SQL => {
    const list = asStringArray(value, field).map((v) => assertUuid(v, field));
    return list.length === 1 ? eq(column, list[0]) : inArray(column, list);
  };
}

// Same, but the value must be one of a known set — keeps a typo'd status from
// silently returning an empty list.
export function enumFilter(
  column: Column,
  field: string,
  allowed: readonly string[],
) {
  return (value: unknown): SQL => {
    const list = asStringArray(value, field);
    for (const v of list) {
      if (!allowed.includes(v)) {
        badRequest(`${field} must be one of: ${allowed.join(', ')}`);
      }
    }
    return list.length === 1 ? eq(column, list[0]) : inArray(column, list);
  };
}

export function intFilter(column: Column, field: string) {
  return (value: unknown): SQL => {
    const n = Number(value);
    if (!Number.isInteger(n)) badRequest(`${field} must be an integer`);
    return eq(column, n);
  };
}

// Presence as a boolean, for columns that record a fact by being set at all
// (rounds.forced_at). The UI shows a yes/no dropdown; the SQL is IS [NOT] NULL.
export function presenceFilter(column: Column, field: string) {
  return (value: unknown): SQL => {
    const truthy = value === true || value === 'true' || value === 1;
    const falsy = value === false || value === 'false' || value === 0;
    if (!truthy && !falsy) badRequest(`${field} must be true or false`);
    return truthy ? isNotNull(column) : isNull(column);
  };
}

// Half-open range bounds, sent by react-admin as `<field>_gte` / `<field>_lte`.
// `mode` decides what the column wants: Postgres timestamps take a Date, the
// console's SQLite columns are integer epochs but Drizzle's timestamp mode
// still hands them Dates — so both take a Date and the driver converts.
export function dateFilter(
  column: Column,
  field: string,
  bound: 'gte' | 'lte',
) {
  return (value: unknown): SQL => {
    if (typeof value !== 'string' && typeof value !== 'number') {
      badRequest(`${field} must be a date`);
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime()))
      badRequest(`${field} is not a valid date`);
    return bound === 'gte' ? gte(column, date) : lte(column, date);
  };
}
