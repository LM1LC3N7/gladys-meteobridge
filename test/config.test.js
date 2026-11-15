import { test } from 'node:test';
import assert from 'node:assert/strict';
import { credentialsKey, normalizeConfig, parseAddress } from '../src/config.js';

test('addresses: IPv4 or host name, optional port; nothing else', () => {
  assert.equal(parseAddress(' http://192.168.1.50/ '), '192.168.1.50');
  assert.equal(parseAddress('192.168.1.50:80'), '192.168.1.50');
  assert.equal(parseAddress('Meteobridge.lan:8080'), 'meteobridge.lan:8080');
  for (const bad of [
    'https://192.168.1.50',
    '192.168.1.50/cgi-bin',
    'user:pw@host',
    '[::1]',
    '999.1.1.1',
    '0.0.0.0',
    '255.255.255.255',
    '224.0.0.1',
    'a b',
    'h:0',
    'h:65536',
    'host\r\nx',
    '-bad.lan',
  ]) {
    assert.equal(parseAddress(bad), null, bad);
  }
});

test('configuration: each missing or bad field gives its error; a password never alone', () => {
  const ok = { address: '192.168.1.50', username: 'meteobridge', password: 'pw' };
  assert.equal(normalizeConfig(ok).error, undefined);
  assert.equal(normalizeConfig({}).error, 'address_missing');
  assert.equal(normalizeConfig({ ...ok, address: 'x/y' }).error, 'address_invalid');
  assert.equal(normalizeConfig({ ...ok, username: '' }).error, 'username_missing');
  assert.equal(normalizeConfig({ ...ok, password: ' ' }).error, 'password_missing');
  assert.equal(normalizeConfig({ ...ok, username: 'a:b' }).error, 'username_invalid');
  assert.equal(normalizeConfig({ ...ok, username: 'é' }).error, 'username_invalid');
  assert.equal(normalizeConfig({ ...ok, password: 'a\nb' }).error, 'password_invalid');
  assert.equal(normalizeConfig({ ...ok, password: 'x'.repeat(129) }).error, 'password_invalid');
  assert.equal(normalizeConfig({ ...ok, password: 'pässwörd' }).error, undefined);
  assert.equal(credentialsKey(normalizeConfig({})), '');
});

test('the interval: minutes within 1 to 60, 1 by default', () => {
  assert.equal(normalizeConfig({}).pollMinutes, 1);
  assert.equal(normalizeConfig({ poll_interval: '0' }).pollMinutes, 1);
  assert.equal(normalizeConfig({ poll_interval: 999 }).pollMinutes, 60);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollMinutes, 1);
  assert.equal(normalizeConfig({ poll_interval: '' }).pollMinutes, 1);
  assert.equal(normalizeConfig({ poll_interval: 7.4 }).pollMinutes, 7);
});
