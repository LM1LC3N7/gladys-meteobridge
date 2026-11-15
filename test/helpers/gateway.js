// -----------------------------------------------------------------------------
// A fake Meteobridge for the tests: `fill(template, sensors)` fills a
// template the way the wiki describes it (`[tag:replacement]`: the value of
// the tag, else the replacement); `installFetch()` routes the requests of the
// module to a handler and records each one. No test touches the network.
// The values are synthetic (no recorded answer is shipped).
// -----------------------------------------------------------------------------

import { setFetch } from '../../src/http.js';

setFetch(async (url) => {
  throw new Error(`Network call without a fake fetch in a test: ${url}`);
});

export const ADDRESS = '192.168.1.50';
export const USER = 'meteobridge';
export const PASSWORD = 'Very-Private-Pw-42';
export const CONFIG = { address: ADDRESS, username: USER, password: PASSWORD, poll_interval: 1 };
export const MAC = '0024a5b31234';

/** What a Davis Vantage Pro2 behind a Meteobridge PRO reports (gateway units). */
export const SENSORS = {
  'mbsystem-mac': '00:24:A5:B3:12:34',
  'mbsystem-platform': 'PRO',
  'mbsystem-station': 'Vantage',
  'mbsystem-swversion': '5.7',
  'th0temp-act': '12.3',
  'th0hum-act': '81.0',
  'th0dew-act': '9.1',
  'thb0temp-act': '21.4',
  'thb0hum-act': '45.0',
  'thb0press-act': '1003.2',
  'thb0seapress-act': '1018.6',
  'wind0avgwind-act': '2.5',
  'wind0wind-act': '6.1',
  'wind0dir-act': '263.0',
  'wind0chill-act': '11.0',
  'rain0rate-act': '1.2',
  'rain0total-sumday': '3.4',
  'uv0index-act': '2.6',
  'sol0rad-act': '400.0',
  'th1temp-act': '24.8',
  'th0lowbat-act': '0.0',
  'rain0lowbat-act': '1.0',
};

/** Fill a template like the gateway does. */
export function fill(template, sensors) {
  return template.replace(/\[([^\]:]+):([^\]]*)\]/g, (_, tag, replacement) =>
    Object.hasOwn(sensors, tag) ? sensors[tag] : replacement,
  );
}

/** The template a request carries (decoded from its query). */
export const templateOf = (url) => new URL(url).searchParams.get('template');

export const text = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'content-type': 'text/plain', ...headers } });

/**
 * Install a fake fetch. `handler(call)` answers (a Response); by default the
 * gateway fills the template with `gw.sensors`. `call` = { url, init, template }.
 */
export function installFetch(handler) {
  const gw = { calls: [], sensors: { ...SENSORS }, handler };
  gw.answer = (call) => text(fill(call.template, gw.sensors));
  const previous = setFetch(async (url, init = {}) => {
    const call = { url, init, template: templateOf(url) };
    gw.calls.push(call);
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return (gw.handler ?? gw.answer)(call, gw);
  });
  gw.restore = () => setFetch(previous);
  return gw;
}
