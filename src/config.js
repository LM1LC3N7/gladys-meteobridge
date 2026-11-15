// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized so
// the rest of the code never deals with strings or `undefined`. A field that
// cannot be used gives `error` (a key of the status texts), never a guess.
// -----------------------------------------------------------------------------

import { POLL_MAX, POLL_MIN } from './constants.js';

// Defaults: they MUST match the `default` values of the manifest
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  poll_interval: 1,
};

const clean = (value) => (typeof value === 'string' ? value.trim() : '');

/** No control character (C0, DEL, C1): never in a header. */
const noControl = (text) =>
  [...text].every((c) => {
    const code = c.codePointAt(0);
    return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f);
  });

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Addresses that are never a gateway: "this network", broadcast, multicast. */
function forbiddenIpv4(value) {
  const [a] = value.split('.').map(Number);
  return a === 0 || a >= 224 || value === '255.255.255.255';
}

/**
 * The address of the gateway as the user may type it: an IPv4 address or a
 * host name, with an optional port. A leading `http://` and a trailing `/`
 * are tolerated; anything else (a path, credentials, IPv6, https) is refused.
 * Returns the `host[:port]`, or null.
 */
export function parseAddress(text) {
  let value = clean(text)
    .replace(/^http:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!value || !noControl(value)) {
    return null;
  }
  let port = '';
  const colon = value.lastIndexOf(':');
  if (colon !== -1) {
    port = value.slice(colon + 1);
    value = value.slice(0, colon);
    const n = Number(port);
    if (!/^\d{1,5}$/.test(port) || n < 1 || n > 65535) {
      return null;
    }
    port = n === 80 ? '' : `:${n}`;
  }
  if (value.length > 253) {
    return null;
  }
  // The host as fetch will read it (WHATWG URL): "0xffffffff", "3232235826",
  // "0300.0250.1.1" or "1.2.3.0xff" are IPv4 addresses there. Only the
  // canonical dotted form of an IPv4 address is accepted, so the bounds
  // below hold on the address really used.
  let host;
  try {
    host = new URL(`http://${value}/`).hostname;
  } catch {
    return null;
  }
  if (IPV4.test(host)) {
    return host === value && !forbiddenIpv4(host) ? `${value}${port}` : null;
  }
  const labels = value.split('.');
  const ok =
    host === value &&
    labels.every((l) => LABEL.test(l)) &&
    !/^(\d+|0x[0-9a-f]*)$/.test(labels.at(-1));
  return ok ? `${value}${port}` : null;
}

/** Minutes, rounded and kept within the manifest bounds. */
const minutes = (value) => {
  const n = Number(value);
  return value !== '' && value !== null && value !== undefined && Number.isFinite(n)
    ? Math.min(POLL_MAX, Math.max(POLL_MIN, Math.round(n)))
    : DEFAULT_CONFIG.poll_interval;
};

/**
 * `{ address, username, password, pollMinutes, error }`. The password is
 * kept as typed (only the spaces around it are dropped) and never leaves
 * this object but in the Authorization header of a request to `address`.
 */
export function normalizeConfig(raw = {}) {
  const text = clean(raw.address);
  const address = parseAddress(text);
  const username = clean(raw.username);
  const password = clean(raw.password);
  let error;
  if (!text) {
    error = 'address_missing';
  } else if (!address) {
    error = 'address_invalid';
  } else if (!username) {
    // A password without a user name is never sent alone.
    error = 'username_missing';
  } else if (!password) {
    error = 'password_missing';
  } else if (username.length > 64 || username.includes(':') || !/^[\x20-\x7e]+$/.test(username)) {
    // Basic authentication: no ":" in the user name, printable ASCII only.
    error = 'username_invalid';
  } else if (Buffer.byteLength(password) > 128 || !noControl(password)) {
    error = 'password_invalid';
  }
  return {
    address: address ?? '',
    username,
    password,
    pollMinutes: minutes(raw.poll_interval),
    error,
  };
}

/** What identifies the credentials sent to a gateway (in memory only). */
export const credentialsKey = (config) =>
  config.error ? '' : JSON.stringify([config.address, config.username, config.password]);
