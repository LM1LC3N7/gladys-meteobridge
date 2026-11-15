// -----------------------------------------------------------------------------
// The request against a real local HTTP server: what the gateway receives,
// the error kinds, the bounds on time and size, no redirection followed.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { templateText } from '../src/fields.js';
import { readGateway } from '../src/meteobridge.js';
import { getText } from '../src/http.js';
import { SENSORS, fill } from './helpers/gateway.js';
import { setFetch } from '../src/http.js';

// The helper installs a throwing fetch: this file talks to a real local server.
setFetch((...args) => globalThis.fetch(...args));

async function server(t, handler) {
  const requests = [];
  const srv = createServer((req, res) => {
    requests.push({ url: req.url, headers: req.headers });
    handler(req, res);
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    srv.closeAllConnections();
    return new Promise((resolve) => srv.close(resolve));
  });
  return { address: `127.0.0.1:${srv.address().port}`, requests };
}

const creds = { username: 'meteobridge', password: 'Pw:with:colons' };

test('the gateway receives the template and the Basic credentials; the answer is read', async (t) => {
  const gw = await server(t, (req, res) => {
    const template = new URL(req.url, 'http://x').searchParams.get('template');
    res.writeHead(200, { 'content-type': 'text/plain; charset=iso-8859-1' });
    res.end(fill(template, SENSORS));
  });
  const answer = await readGateway({ address: gw.address, ...creds });
  assert.equal(answer.mac, '0024a5b31234');
  assert.equal(answer.values.temperature, 12.3);
  const [req] = gw.requests;
  assert.equal(new URL(req.url, 'http://x').searchParams.get('template'), templateText());
  assert.equal(
    Buffer.from(req.headers.authorization.replace(/^Basic /, ''), 'base64').toString(),
    'meteobridge:Pw:with:colons',
  );
  assert.ok(!req.url.includes('Pw'));
});

test('the error kinds: 401 refused, 403 denied, 404 invalid, 503 busy with Retry-After', async (t) => {
  let status = 401;
  const gw = await server(t, (req, res) => {
    res.writeHead(status, status === 503 ? { 'retry-after': '120' } : {});
    res.end('no');
  });
  const kind = async () => {
    try {
      await readGateway({ address: gw.address, ...creds });
      return 'ok';
    } catch (err) {
      return [err.kind, err.retryAfterMs];
    }
  };
  assert.deepEqual(await kind(), ['refused', undefined]);
  status = 403;
  assert.deepEqual(await kind(), ['denied', undefined]);
  status = 404;
  assert.deepEqual(await kind(), ['invalid', undefined]);
  status = 503;
  assert.deepEqual(await kind(), ['busy', 120_000]);
  status = 418;
  assert.deepEqual(await kind(), ['failed', undefined]);
});

test('a redirection is never followed (the password would go along)', async (t) => {
  const target = await server(t, (req, res) => res.end('x'));
  const gw = await server(t, (req, res) => {
    res.writeHead(302, { location: `http://${target.address}/` });
    res.end();
  });
  await assert.rejects(readGateway({ address: gw.address, ...creds }), { kind: 'failed' });
  assert.equal(target.requests.length, 0);
});

test('an endless body is cut at the bound, before it ends', async (t) => {
  let sent = 0;
  const gw = await server(t, (req, res) => {
    res.writeHead(200);
    const chunk = Buffer.alloc(8192, 0x41);
    const push = () => {
      while (sent < 10 * 1024 * 1024 && res.write(chunk)) sent += chunk.length;
      if (sent < 10 * 1024 * 1024) res.once('drain', push);
      else res.end();
    };
    push();
  });
  await assert.rejects(getText(`http://${gw.address}/`), /answer too large/);
  assert.ok(sent < 10 * 1024 * 1024, 'stopped well before the end');
});

test('a silent gateway: the request ends at its timeout', async (t) => {
  const gw = await server(t, () => {});
  const started = Date.now();
  await assert.rejects(getText(`http://${gw.address}/`, { timeout: 200 }), /timeout/);
  assert.ok(Date.now() - started < 5000);
});

test('a body that stalls after its headers: the timeout covers the body read', async (t) => {
  const gw = await server(t, (req, res) => {
    res.writeHead(200);
    res.write('gladys-meteobridge=1\n');
  });
  await assert.rejects(getText(`http://${gw.address}/`, { timeout: 200 }), /timeout/);
});
