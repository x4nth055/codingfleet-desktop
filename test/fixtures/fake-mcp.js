'use strict';
// A minimal MCP server over stdio, for the tests: one "echo" tool and one that fails.
const readline = require('node:readline');

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const lines = readline.createInterface({ input: process.stdin });

lines.on('line', (line) => {
  const message = JSON.parse(line);
  if (message.id === undefined) return; // a notification
  if (message.method === 'initialize') {
    send({ jsonrpc: '2.0', id: message.id, result: {
      protocolVersion: message.params.protocolVersion, capabilities: { tools: {} },
      serverInfo: { name: 'fake', version: '1' },
    } });
  } else if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: [
      { name: 'echo', description: 'Echo the text.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
      { name: 'fail', description: 'Always fails.', inputSchema: { type: 'object', properties: {} } },
    ] } });
  } else if (message.method === 'tools/call') {
    const { name, arguments: args } = message.params;
    if (name === 'echo') {
      send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: `echo: ${args.text} ${process.env.FAKE_SUFFIX || ''}`.trim() }] } });
    } else {
      send({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'it broke' }], isError: true } });
    }
  } else {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown' } });
  }
});
