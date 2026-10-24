'use strict';
// The browser tool's plain pieces: addresses, keys, and which approvals the
// window treats as always asked. test/browser.cjs drives a real page.
const assert = require('node:assert/strict');
const test = require('node:test');

const page = require('../src/core/browser-page');
const guard = require('../src/core/guard');
const words = require('../src/renderer/lib/tool-words');

test('an address gets a scheme, and only http(s) pages load', () => {
  assert.equal(page.normalizeUrl('localhost:3000'), 'http://localhost:3000/');
  assert.equal(page.normalizeUrl('127.0.0.1:5173/app'), 'http://127.0.0.1:5173/app');
  assert.equal(page.normalizeUrl('example.com/docs'), 'https://example.com/docs');
  assert.equal(page.normalizeUrl('https://example.com'), 'https://example.com/');
  assert.equal(page.normalizeUrl('about:blank'), 'about:blank');
  for (const bad of ['', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.c', 'chrome://settings']) {
    assert.equal(page.normalizeUrl(bad), null, bad);
  }
});

test('pages on this computer are local, every other site is not', () => {
  for (const url of ['http://localhost:3000/', 'http://127.0.0.1:8000/x', 'http://[::1]:4000/', 'http://app.localhost/', 'about:blank']) {
    assert.ok(page.isLocalUrl(url), url);
  }
  for (const url of ['https://example.com/', 'http://localhost.example.com/', 'http://192.168.1.10/']) {
    assert.ok(!page.isLocalUrl(url), url);
  }
  assert.equal(page.siteOf('https://docs.example.com:8443/a'), 'docs.example.com:8443');
});

test('keys are read the way the agent writes them', () => {
  assert.deepEqual(page.parseKeys('Enter').keys, [{ keyCode: 'Enter', modifiers: [] }]);
  assert.deepEqual(page.parseKeys('Control+A Backspace').keys, [
    { keyCode: 'A', modifiers: ['control'] }, { keyCode: 'Backspace', modifiers: [] }]);
  assert.deepEqual(page.parseKeys('shift+tab').keys, [{ keyCode: 'Tab', modifiers: ['shift'] }]);
  assert.deepEqual(page.parseKeys('ArrowDown').keys, [{ keyCode: 'Down', modifiers: [] }]);
  assert.match(page.parseKeys('Control+Hyper').error, /Unknown key/);
  assert.match(page.parseKeys('').error, /No keys/);
});

test('the sites a user lists are cleaned, and cover the sites under them', () => {
  assert.equal(page.normalizeSite('https://Docs.Example.com:8443/x'), 'docs.example.com');
  assert.equal(page.normalizeSite('*.example.com'), 'example.com');
  assert.equal(page.normalizeSite('example.com.'), 'example.com');
  for (const bad of ['', 'not a site', 'http://', '..']) assert.equal(page.normalizeSite(bad), null, bad);
  assert.ok(page.onSiteList('https://example.com/a', ['example.com']));
  assert.ok(page.onSiteList('https://docs.example.com/a', ['example.com']));
  assert.ok(!page.onSiteList('https://notexample.com/', ['example.com']));
  assert.ok(!page.onSiteList('https://example.com.evil.io/', ['example.com']));
});

test('typing into a site always asks; a site asks once and is then allowed for the session', () => {
  assert.ok(guard.mustAsk('types into example.com', { auto: true, allowedThisSession: true }));
  assert.ok(guard.alwaysAsk('types into example.com'));
  assert.ok(!guard.mustAsk('uses example.com in the browser', { auto: false, allowedThisSession: true }));
  assert.ok(!guard.mustAsk('uses example.com in the browser', { auto: true, allowedThisSession: false }));
  assert.ok(guard.mustAsk('uses example.com in the browser', { auto: false, allowedThisSession: false }));
  // The window agrees: a site's only yes is for the session, typing has no "allow all".
  assert.ok(words.alwaysAsked('types into example.com'));
  assert.ok(!words.alwaysAsked('uses example.com in the browser'));
  assert.ok(words.sessionOnly('uses example.com in the browser'));
  assert.ok(!words.sessionOnly('runs a command'));
  assert.equal(words.reasonText('uses example.com in the browser'), 'wants to use example.com in its browser');
  assert.equal(words.reasonText('types into example.com'), 'wants to type into example.com in its browser');
  assert.equal(words.allowLabel('uses example.com in the browser'), 'Allow example.com this session');
  // "Always allow" names the site without its port, as the list in Preferences keeps it.
  assert.equal(words.siteOfReason('uses localhost.example.com:8443 in the browser'), 'localhost.example.com');
  assert.equal(words.siteOfReason('runs a command'), null);
  assert.deepEqual(words.toolSummary({ name: 'browser', arguments: { action: 'navigate', url: 'http://localhost:3000' } }),
    ['Open', 'http://localhost:3000']);
});
