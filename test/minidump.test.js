'use strict';
// What a crash report says of a crash dump: read from a small dump built here,
// laid out as Crashpad writes them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { readDump, describeDump } = require('../src/core/minidump');

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

// A dump of one thread that threw a C++ exception from inside `addon.node`.
function buildDump({ process: processType = 'browser', code = 0xe06d7363 } = {}) {
  const parts = [Buffer.alloc(32)];
  let size = 32;
  const put = (...buffers) => {
    const at = size;
    const buffer = Buffer.concat(buffers);
    parts.push(buffer);
    size += buffer.length;
    return at;
  };
  const wide = (text) => put(u32(Buffer.byteLength(text, 'utf16le')), Buffer.from(text, 'utf16le'), u16(0));
  const utf8 = (text) => put(u32(Buffer.byteLength(text)), Buffer.from(text), Buffer.alloc(1));

  const APP = 0x7ff600000000n;
  const ADDON = 0x7ffb00000000n;
  const SYSTEM = 0x7ffc00000000n;
  const module = (base, bytes, nameAt) => {
    const entry = Buffer.alloc(108);
    entry.writeBigUInt64LE(base, 0);
    entry.writeUInt32LE(bytes, 8);
    entry.writeUInt32LE(nameAt, 20);
    return entry;
  };
  const modules = put(u32(3),
    module(APP, 0x10000000, wide('C:\\Users\\someone\\AppData\\Local\\Programs\\app\\App.exe')),
    module(ADDON, 0x60000, wide('C:\\Users\\someone\\AppData\\Local\\Programs\\app\\resources\\addon.node')),
    module(SYSTEM, 0x200000, wide('C:\\WINDOWS\\System32\\KERNELBASE.dll')));

  const system = put(u16(9), Buffer.alloc(54));

  // The stack: two return addresses in the add-on, one in the app, a repeat,
  // the add-on's own start (data, not code) and numbers that are no address.
  const STACK = 0x2bb93f0000n;
  const stack = put(u64(SYSTEM + 0xc408an), u64(42), u64(ADDON + 0x10b13n), u64(ADDON), u64(ADDON + 0x2a6en),
    u64(ADDON + 0x10b13n), u64(APP + 0x7f1867en), u64(0));
  const memory = put(u32(1), u64(STACK), u32(64), u32(stack));

  const context = Buffer.alloc(0x4d0);
  context.writeBigUInt64LE(STACK, 0x98);
  const contextAt = put(context);
  const record = Buffer.alloc(168);
  record.writeUInt32LE(7, 0);
  record.writeUInt32LE(code, 8);
  record.writeBigUInt64LE(SYSTEM + 0xc408an, 24);
  record.writeUInt32LE(4, 32);
  [0x19930520n, STACK + 0x100n, ADDON + 0x46a58n, ADDON].forEach((value, i) => record.writeBigUInt64LE(value, 40 + i * 8));
  record.writeUInt32LE(context.length, 160);
  record.writeUInt32LE(contextAt, 164);
  const exception = put(record);

  const simple = put(u32(1), u32(utf8('_version')), u32(utf8('1.3.3')));
  const objects = put(u32(1), u32(utf8('ptype')), u16(1), u16(0), u32(put(u32(processType.length), Buffer.from(processType))));
  const moduleInfo = Buffer.alloc(28);
  moduleInfo.writeUInt32LE(12, 20);
  moduleInfo.writeUInt32LE(objects, 24);
  const links = put(u32(1), u32(0), u32(28), u32(put(moduleInfo)));
  const info = Buffer.alloc(52);
  info.writeUInt32LE(1, 0);
  info.writeUInt32LE(12, 36);
  info.writeUInt32LE(simple, 40);
  info.writeUInt32LE(16, 44);
  info.writeUInt32LE(links, 48);
  const crashpad = put(info);

  const streams = [[7, 56, system], [4, 4 + 3 * 108, modules], [5, 20, memory], [6, 168, exception], [0x43500001, 52, crashpad]];
  const directory = put(...streams.map(([type, length, at]) => Buffer.concat([u32(type), u32(length), u32(at)])));
  const header = parts[0];
  header.write('MDMP', 0, 'latin1');
  header.writeUInt32LE(streams.length, 8);
  header.writeUInt32LE(directory, 12);
  header.writeUInt32LE(Date.UTC(2026, 10, 12, 0, 13, 20) / 1000, 20);
  return Buffer.concat(parts);
}

function dumpFile(buffer) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cf-dump-')), 'a.dmp');
  fs.writeFileSync(file, buffer);
  return file;
}

test('a dump says which process died, on what exception, and who threw it', () => {
  const dump = readDump(dumpFile(buildDump()));
  assert.equal(dump.at, '2026-11-12T00:13:20.000Z');
  assert.equal(dump.process, 'browser');
  assert.equal(dump.version, '1.3.3');
  assert.deepEqual(dump.exception, { code: '0xe06d7363', name: 'C++ exception', at: 'KERNELBASE.dll+0xc408a', thrownBy: 'addon.node' });
});

test('the stack lists each code address once, in order, as module and offset', () => {
  const dump = readDump(dumpFile(buildDump()));
  assert.deepEqual(dump.stack, ['KERNELBASE.dll+0xc408a', 'addon.node+0x10b13', 'addon.node+0x2a6e', 'App.exe+0x7f1867e']);
});

test('the text for a report names no folder, so no user name', () => {
  const text = describeDump(dumpFile(buildDump()));
  assert.match(text, /^crash dump of 2026-11-12T00:13:20\.000Z: main process, version 1\.3\.3\n/);
  assert.match(text, /exception 0xe06d7363 \(C\+\+ exception\) at KERNELBASE\.dll\+0xc408a, thrown by addon\.node/);
  assert.match(text, /on the stack: KERNELBASE\.dll\+0xc408a addon\.node\+0x10b13/);
  assert.doesNotMatch(text, /someone|Users|\\/);
});

test('a helper process is named as one, and another exception by its code', () => {
  const text = describeDump(dumpFile(buildDump({ process: 'gpu-process', code: 0xc0000005 })));
  assert.match(text, /: gpu-process process, version/);
  assert.match(text, /exception 0xc0000005 \(access violation\) at KERNELBASE\.dll\+0xc408a\n/);
});

test('a file that is no dump, or half of one, says nothing and does not throw', () => {
  assert.equal(describeDump(dumpFile(Buffer.from('not a dump at all'))), '');
  assert.equal(describeDump(dumpFile(buildDump().subarray(0, 200))), '');
  assert.equal(describeDump(path.join(os.tmpdir(), 'no-such-dump.dmp')), '');
  assert.equal(readDump(dumpFile(Buffer.alloc(0))), null);
});
