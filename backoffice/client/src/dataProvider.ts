import simpleRestProvider from 'ra-data-simple-rest';
import { DataProvider } from 'react-admin';
import { API_URL, httpClient } from './http';
import { DashboardData, EngineState, RetryResult } from './types';

// react-admin's five CRUD verbs come straight from ra-data-simple-rest: the
// server was built to its contract (?filter/&range/&sort plus Content-Range),
// so there is nothing to translate.
//
// The four methods below are not CRUD. An operator pausing the engine is not
// "updating a resource" — there is no record to put, no id to route by, and the
// platform is the thing that decides. Modelling them as a fake resource would
// give react-admin an optimistic cache entry for a fact it cannot know.
export interface BackofficeDataProvider extends DataProvider {
  getDashboard(): Promise<DashboardData>;
  setEnginePaused(paused: boolean): Promise<EngineState>;
  forceCrash(): Promise<{ roundId: string }>;
  retryWalletOps(txRef?: string): Promise<RetryResult>;
}

const base = simpleRestProvider(API_URL, httpClient);

async function post<T>(path: string, body?: unknown): Promise<T> {
  const { json } = await httpClient(`${API_URL}${path}`, {
    method: 'POST',
    body: JSON.stringify(body ?? {}),
  });
  return json as T;
}

export const dataProvider: BackofficeDataProvider = {
  ...base,

  async getDashboard() {
    const { json } = await httpClient(`${API_URL}/dashboard`);
    return json as DashboardData;
  },

  setEnginePaused(paused: boolean) {
    return post<EngineState>('/engine/pause', { paused });
  },

  forceCrash() {
    return post<{ roundId: string }>('/engine/force-crash');
  },

  // No txRef means "every failed op". The server treats both as the same
  // idempotent replay; the UI is what makes them different decisions.
  retryWalletOps(txRef?: string) {
    return post<RetryResult>('/wallet-ops/retry', txRef ? { txRef } : {});
  },
};
