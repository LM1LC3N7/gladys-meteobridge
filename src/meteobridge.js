// -----------------------------------------------------------------------------
// The one request to the gateway: GET /cgi-bin/template.cgi with the template
// of src/fields.js, Basic authentication (the user name and password of the
// Meteobridge web interface). Read only: no other page, never a setting.
//
// Error kinds (SourceError.kind):
//   refused  401: the user name or the password is refused (the only page
//            read, so a 401 is a refusal of the credentials)
//   denied   403: not a refusal of the credentials (a proxy, a firewall)
//   busy     429, 5xx: a pause
//   invalid  404, or an answer that is not the filled template, or one
//            without a readable MAC address
//   failed   anything else (no answer, timeout, answer too large, 3xx...)
// -----------------------------------------------------------------------------

import { TEMPLATE_PATH } from './constants.js';
import { parseAnswer, templateText } from './fields.js';
import { HttpError, getText, retryAfterMs } from './http.js';

export class SourceError extends Error {
  constructor(kind, { retryAfterMs: wait, status } = {}) {
    super(status ? `${kind} (HTTP ${status})` : kind);
    this.name = 'SourceError';
    this.kind = kind;
    this.retryAfterMs = wait;
    this.status = status;
  }
}

/** The URL of the template page; the password never travels in it. */
export function templateUrl(address) {
  const query = `template=${encodeURIComponent(templateText())}&contenttype=text%2Fplain`;
  return `http://${address}${TEMPLATE_PATH}?${query}`;
}

const basic = (username, password) =>
  `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;

/**
 * Read the gateway. Resolves `{ mac, platform, station, version, values }`;
 * throws a SourceError.
 */
export async function readGateway({ address, username, password, signal }) {
  let text;
  try {
    text = await getText(templateUrl(address), {
      headers: { Authorization: basic(username, password) },
      signal,
    });
  } catch (err) {
    if (err instanceof HttpError) {
      const { status } = err;
      if (status === 401) {
        throw new SourceError('refused', { status });
      }
      if (status === 403) {
        throw new SourceError('denied', { status });
      }
      if (status === 429 || status >= 500) {
        throw new SourceError('busy', {
          status,
          retryAfterMs: retryAfterMs(err.retryAfter, err.date),
        });
      }
      if (status === 404) {
        throw new SourceError('invalid', { status });
      }
      throw new SourceError('failed', { status });
    }
    throw new SourceError(err?.reason === 'stopped' ? 'stopped' : 'failed');
  }
  const answer = parseAnswer(text);
  if (!answer.ok) {
    throw new SourceError('invalid');
  }
  return answer;
}
