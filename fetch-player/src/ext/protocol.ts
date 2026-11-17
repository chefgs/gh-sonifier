/** The message contract between the app page and the service worker. */

import type { YearData } from '../core/types.ts';

export interface FetchYearRequest {
  kind: 'fetch-year';
  user: string;
  year: number;
}

export type ErrorCode =
  | 'invalid-user'
  | 'bad-request'
  | 'not-found'
  | 'rate-limited'
  | 'busy'
  | 'timeout'
  | 'network'
  | 'upstream'
  | 'too-large'
  | 'unrecognised';

export interface FetchYearOk {
  ok: true;
  data: YearData;
  cached: boolean;
}

export interface FetchYearError {
  ok: false;
  code: ErrorCode;
  /** Already written for a person to read. The UI shows this verbatim. */
  message: string;
}

export type FetchYearResponse = FetchYearOk | FetchYearError;

/**
 * Every failure a user can hit, in words they can act on. No status codes on their own,
 * no parser internals, no stack traces.
 */
export const MESSAGES: Record<ErrorCode, string> = {
  'invalid-user': 'That is not a valid GitHub username. Usernames use letters, numbers and single hyphens.',
  'bad-request': 'That request did not make sense. Reload the page and try again.',
  'not-found': 'GitHub has no public profile with that username. Check the spelling, or try another year.',
  'rate-limited': 'GitHub is asking us to slow down. Wait about a minute, then try again.',
  'busy': 'Too many lookups at once. Wait a few seconds, then try again.',
  'timeout': 'GitHub took too long to answer. Check your connection and try again.',
  'network': 'Could not reach github.com. Check your connection and try again, or load a saved JSON file below to keep playing offline.',
  'upstream': 'GitHub could not return that contribution graph right now. It may be having trouble — try again in a moment.',
  'too-large': 'That page was far larger than a contribution graph should be, so it was not read. Try again, or load a saved JSON file below.',
  'unrecognised': 'GitHub seems to have changed the contribution graph markup, so this reader could not understand it. Loading a saved JSON file below still works.',
};

export function errorResponse(code: ErrorCode, message?: string): FetchYearError {
  return { ok: false, code, message: message ?? MESSAGES[code] };
}
