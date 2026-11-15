// -----------------------------------------------------------------------------
// The only place that talks to the network: one GET with a timeout (the body
// read included), an identifiable User-Agent, no redirect followed (it would
// carry the password elsewhere) and a bounded body. The tests replace `fetch`
// with `setFetch()`. Errors never carry a header, a body nor a URL.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, MAX_BODY, USER_AGENT } from './constants.js';

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace the fetch implementation (tests only). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/** A non-2xx answer (a 3xx included): its status and Retry-After, Date headers. */
export class HttpError extends Error {
  constructor(status, { retryAfter, date } = {}) {
    super(`HTTP ${status}`);
    this.name = 'HttpError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.date = date;
  }
}

/** The request or the body read failed: a short reason only. */
export class NetworkError extends Error {
  constructor(reason) {
    super(`network: ${reason}`);
    this.name = 'NetworkError';
    this.reason = reason;
  }
}

/** Read a body, stopping as soon as it exceeds `limit` bytes. */
async function readBounded(response, limit, controller) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    controller.abort();
    throw new NetworkError('answer too large');
  }
  if (!response.body?.getReader) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      controller.abort();
      await reader.cancel().catch(() => {});
      throw new NetworkError('answer too large');
    }
    chunks.push(value);
  }
  // The gateway answers in ISO-8859-1 (wiki): only ASCII is used from it.
  return Buffer.concat(chunks, size).toString('latin1');
}

/**
 * GET a text document: resolves its text on a 2xx. Throws HttpError on any
 * other status (never followed) and NetworkError on a timeout, an abort by
 * `signal`, a network failure or an oversized body.
 */
export async function getText(
  url,
  { headers = {}, timeout = HTTP_TIMEOUT, limit = MAX_BODY, signal } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeout));
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) {
    controller.abort();
  }
  try {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain', ...headers },
      signal: controller.signal,
    });
    if (!(response.status >= 200 && response.status < 300)) {
      controller.abort();
      await response.body?.cancel?.().catch(() => {});
      throw new HttpError(response.status, {
        retryAfter: response.headers?.get?.('retry-after') ?? undefined,
        date: response.headers?.get?.('date') ?? undefined,
      });
    }
    return await readBounded(response, limit, controller);
  } catch (err) {
    if (err instanceof HttpError || err instanceof NetworkError) {
      throw err;
    }
    if (signal?.aborted) {
      throw new NetworkError('stopped');
    }
    if (controller.signal.aborted) {
      throw new NetworkError('timeout');
    }
    throw new NetworkError('failed');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * The wait asked by a `Retry-After` header, in ms, or undefined. A date is
 * compared to the answer's own `Date` header (never to our clock); without a
 * readable `Date`, a date is ignored.
 */
export function retryAfterMs(retryAfter, date) {
  if (retryAfter === undefined || retryAfter === null) {
    return undefined;
  }
  const text = String(retryAfter).trim();
  if (/^\d{1,9}$/.test(text)) {
    return Number(text) * 1000;
  }
  const until = Date.parse(text);
  const at = date ? Date.parse(date) : NaN;
  if (Number.isNaN(until) || Number.isNaN(at)) {
    return undefined;
  }
  return Math.max(0, until - at);
}
