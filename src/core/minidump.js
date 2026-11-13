'use strict';
// What a crash dump says, in a few lines a crash report can carry.
//
// When the app dies in native code no JavaScript runs, so all that is left is
// the minidump Electron wrote. The dump itself stays on this computer (it holds
// memory); this reads only which process it was, the exception, and the code
// addresses on the crashing thread's stack, each as "module+offset". Module
// names are file names without their folders, so no path — and no user name —
// goes into a report. Those few lines are enough to find the fault with the
// module's symbols. No Electron here: plain file reads, a few kilobytes of a
// dump that is tens of megabytes.
const fs = require('fs');

const STREAM = { threads: 3, modules: 4, memory: 5, exception: 6, system: 7, memory64: 9, crashpad: 0x43500001 };
const CODES = {
  0x80000003: 'breakpoint: a failed check in the app or in Chromium',
  0xc0000005: 'access violation',
  0xc000001d: 'illegal instruction',
  0xc00000fd: 'stack overflow',
  0xc0000374: 'heap corruption',
  0xc0000409: 'fail fast',
  0xe0000008: 'out of memory',
  0xe06d7363: 'C++ exception',
};
const AMD64 = 9;
const ARM64 = 12;
// Where the stack pointer is in the saved registers of each processor.
const STACK_POINTER = { [AMD64]: 0x98, [ARM64]: 0x100 };
const MAX_MODULES = 4000;
const MAX_RANGES = 100000;
const STACK_BYTES = 16 * 1024;
const MAX_FRAMES = 24;

const hex = (n) => `0x${n.toString(16)}`;
const baseName = (file) => String(file).split(/[\\/]/).pop();

/** The dump at `file`, or null when it is not one or cannot be read. */
function readDump(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    return parse(fd, fs.fstatSync(fd).size);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* already closed */ }
  }
}

function parse(fd, size) {
  const read = (offset, length) => {
    if (offset < 0 || length < 0 || offset + length > size) throw new Error('outside the file');
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, offset);
    return buffer;
  };
  const text = (rva, encoding, limit = 2048) => {
    const length = read(rva, 4).readUInt32LE(0);
    return read(rva + 4, Math.min(length, limit)).toString(encoding);
  };

  const header = read(0, 32);
  if (header.toString('latin1', 0, 4) !== 'MDMP') return null;
  const count = Math.min(header.readUInt32LE(8), 256);
  const directory = read(header.readUInt32LE(12), count * 12);
  const streams = new Map();
  for (let i = 0; i < count; i++) {
    streams.set(directory.readUInt32LE(i * 12), { size: directory.readUInt32LE(i * 12 + 4), rva: directory.readUInt32LE(i * 12 + 8) });
  }
  const dump = { at: new Date(header.readUInt32LE(20) * 1000).toISOString(), process: '', version: '', exception: null, stack: [] };

  const modules = [];
  if (streams.has(STREAM.modules)) {
    const { rva } = streams.get(STREAM.modules);
    const n = Math.min(read(rva, 4).readUInt32LE(0), MAX_MODULES);
    const list = read(rva + 4, n * 108);
    for (let i = 0; i < n; i++) {
      const at = i * 108;
      modules.push({ base: list.readBigUInt64LE(at), size: BigInt(list.readUInt32LE(at + 8)), name: baseName(text(list.readUInt32LE(at + 20), 'utf16le')) });
    }
  }
  const where = (address) => {
    const module = modules.find((m) => address >= m.base && address < m.base + m.size);
    return module ? `${module.name}+${hex(address - module.base)}` : null;
  };

  if (streams.has(STREAM.exception)) {
    const record = read(streams.get(STREAM.exception).rva, 168);
    const code = record.readUInt32LE(8);
    const address = record.readBigUInt64LE(24);
    const parameters = [];
    for (let i = 0; i < Math.min(record.readUInt32LE(32), 15); i++) parameters.push(record.readBigUInt64LE(40 + i * 8));
    dump.exception = { code: hex(code), name: CODES[code] || '', at: where(address) || hex(address) };
    // A C++ exception is raised from inside Windows; what threw it is named by
    // the image its type lives in.
    if (code === 0xe06d7363 && parameters.length >= 4) {
      const thrower = modules.find((m) => m.base === parameters[3]);
      if (thrower) dump.exception.thrownBy = thrower.name;
    }
    dump.stack = stackOf(read, streams, record, where);
  }

  Object.assign(dump, crashpadNotes(read, text, streams));
  return dump;
}

// The code addresses lying on the crashing thread's stack, top first. Not a
// true backtrace (that takes the modules' unwind tables), but the callers are
// all among them, in order.
function stackOf(read, streams, record, where) {
  if (!streams.has(STREAM.system)) return [];
  const pointerAt = STACK_POINTER[read(streams.get(STREAM.system).rva, 2).readUInt16LE(0)];
  const contextSize = record.readUInt32LE(160);
  if (!pointerAt || contextSize < pointerAt + 8) return [];
  const pointer = read(record.readUInt32LE(164), contextSize).readBigUInt64LE(pointerAt);
  const memory = memoryAt(read, streams, pointer, STACK_BYTES);
  const found = [];
  for (let i = 0; memory && i + 8 <= memory.length && found.length < MAX_FRAMES; i += 8) {
    const place = where(memory.readBigUInt64LE(i));
    if (place && !place.endsWith('+0x0') && !found.includes(place)) found.push(place);
  }
  return found;
}

function memoryAt(read, streams, address, length) {
  const take = (start, size, offset) => {
    if (address < start || address >= start + size) return null;
    return read(Number(offset + (address - start)), Number(size - (address - start) < BigInt(length) ? size - (address - start) : BigInt(length)));
  };
  if (streams.has(STREAM.memory)) {
    const { rva } = streams.get(STREAM.memory);
    const n = Math.min(read(rva, 4).readUInt32LE(0), MAX_RANGES);
    const list = read(rva + 4, n * 16);
    for (let i = 0; i < n; i++) {
      const found = take(list.readBigUInt64LE(i * 16), BigInt(list.readUInt32LE(i * 16 + 8)), BigInt(list.readUInt32LE(i * 16 + 12)));
      if (found) return found;
    }
  }
  if (streams.has(STREAM.memory64)) {
    const { rva } = streams.get(STREAM.memory64);
    const head = read(rva, 16);
    const n = Math.min(Number(head.readBigUInt64LE(0)), MAX_RANGES);
    let offset = head.readBigUInt64LE(8);
    const list = read(rva + 16, n * 16);
    for (let i = 0; i < n; i++) {
      const size = list.readBigUInt64LE(i * 16 + 8);
      const found = take(list.readBigUInt64LE(i * 16), size, offset);
      if (found) return found;
      offset += size;
    }
  }
  return null;
}

// Which of the app's processes it was ("browser" is the main one), and the
// app's version when the dump was written: Crashpad's own notes in the dump.
function crashpadNotes(read, text, streams) {
  const notes = {};
  try {
    if (!streams.has(STREAM.crashpad)) return notes;
    const info = read(streams.get(STREAM.crashpad).rva, 52);
    if (info.readUInt32LE(36)) {
      const rva = info.readUInt32LE(40);
      const n = Math.min(read(rva, 4).readUInt32LE(0), 64);
      const pairs = read(rva + 4, n * 8);
      for (let i = 0; i < n; i++) {
        if (text(pairs.readUInt32LE(i * 8), 'utf8', 64) === '_version') notes.version = text(pairs.readUInt32LE(i * 8 + 4), 'utf8', 64);
      }
    }
    if (!info.readUInt32LE(44)) return notes;
    const listRva = info.readUInt32LE(48);
    const n = Math.min(read(listRva, 4).readUInt32LE(0), 64);
    const links = read(listRva + 4, n * 12);
    for (let i = 0; i < n && !notes.process; i++) {
      const module = read(links.readUInt32LE(i * 12 + 8), 28);
      if (!module.readUInt32LE(20)) continue;
      const objectsRva = module.readUInt32LE(24);
      const objects = Math.min(read(objectsRva, 4).readUInt32LE(0), 256);
      const entries = read(objectsRva + 4, objects * 12);
      for (let k = 0; k < objects; k++) {
        if (text(entries.readUInt32LE(k * 12), 'utf8', 64) === 'ptype') notes.process = text(entries.readUInt32LE(k * 12 + 8), 'utf8', 64);
      }
    }
  } catch { /* a dump without them still says where it crashed */ }
  return notes;
}

/** A dump in a few lines of text, or '' when the file is not a dump. */
function describeDump(file) {
  const dump = readDump(file);
  if (!dump) return '';
  const which = dump.process === 'browser' ? 'main process' : dump.process ? `${dump.process} process` : 'unknown process';
  const lines = [`crash dump of ${dump.at}: ${which}${dump.version ? `, version ${dump.version}` : ''}`];
  if (dump.exception) {
    const { code, name, at, thrownBy } = dump.exception;
    lines.push(`  exception ${code}${name ? ` (${name})` : ''} at ${at}${thrownBy ? `, thrown by ${thrownBy}` : ''}`);
  }
  if (dump.stack.length) lines.push(`  on the stack: ${dump.stack.join(' ')}`);
  return lines.join('\n');
}

module.exports = { readDump, describeDump };
