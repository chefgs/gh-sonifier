/**
 * Service worker. Opens the app in a tab and answers fetch requests from it.
 *
 * The page itself never fetches github.com: a content script or page fetch would be
 * blocked by CORS anyway, and keeping the single network call in here means the host
 * permission is used in exactly one place.
 */

import { fetchYear } from './fetchYear.ts';
import { errorResponse } from './protocol.ts';
import type { FetchYearResponse } from './protocol.ts';

const APP_PAGE = 'app.html';

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL(APP_PAGE) });
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  // Only our own extension pages may ask for a fetch.
  if (sender.id !== chrome.runtime.id) {
    respond(errorResponse('bad-request'));
    return false;
  }

  const request = message as { kind?: unknown; user?: unknown; year?: unknown } | null;
  if (request === null || typeof request !== 'object' || request.kind !== 'fetch-year') {
    respond(errorResponse('bad-request'));
    return false;
  }

  void (async (): Promise<void> => {
    let response: FetchYearResponse;
    try {
      response = await fetchYear(request.user, request.year, { fetch: globalThis.fetch });
    } catch {
      // Nothing should reach here, but a thrown worker leaves the UI hanging forever.
      response = errorResponse('upstream');
    }
    respond(response);
  })();

  return true; // keep the message channel open for the async reply
});
