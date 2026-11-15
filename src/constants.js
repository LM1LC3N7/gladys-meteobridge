// -----------------------------------------------------------------------------
// Limits, pacing and the keys users store (manifest keys, device type): the
// keys are forever, never rename them.
// -----------------------------------------------------------------------------

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

/** The documented template page of the Meteobridge web server (wiki, "Add-On Services"). */
export const TEMPLATE_PATH = '/cgi-bin/template.cgi';

export const USER_AGENT =
  'gladys-meteobridge/0.1.0 (+https://github.com/LM1LC3N7/gladys-meteobridge)';

/** One HTTP request to the gateway (the body read included). */
export const HTTP_TIMEOUT = 10 * SECOND;

/** The filled template weighs well under 2 KB: anything past this is cut. */
export const MAX_BODY = 16 * 1024;

/** At most this many lines of the answer are looked at. */
export const MAX_LINES = 200;

/** Read interval, in minutes (manifest `poll_interval`). */
export const POLL_MIN = 1;
export const POLL_MAX = 60;

/**
 * 429 / 5xx: a pause, from Retry-After when given, else 1 minute doubling,
 * always between 1 and 30 minutes (a gateway on the local network that is
 * restarting or updating its firmware).
 */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 30 * MINUTE;

/**
 * A reading is published as current for twice the interval, at least 5
 * minutes, at most 2 hours; past it, nothing is published.
 */
export const FRESH_MIN = 5 * MINUTE;
export const FRESH_MAX = 2 * HOUR;

/** An unchanged value is sent again this often, so Gladys keeps it recent. */
export const HEARTBEAT = 30 * MINUTE;

/** /data: each operation bounded; unreadable, read again on its own timer. */
export const DATA_TIMEOUT = 5 * SECOND;
export const DATA_RETRY = 10 * SECOND;

/** getConfig() failed in `connected`: retried, 10 s doubling up to 5 minutes. */
export const CONFIG_RETRY_MIN = 10 * SECOND;
export const CONFIG_RETRY_MAX = 5 * MINUTE;

/** A date of /data this far in the future is invalid (a clock set back). */
export const SKEW = MINUTE;

/** The status text is cut past this length. */
export const MAX_STATUS_LENGTH = 900;

/** Device type of the external ids (`ext:<selector>:gateway:<mac>`). */
export const DEVICE_TYPE = 'gateway';

/** Manifest `actions` keys. */
export const ACTION_TEST = 'test_connection';
