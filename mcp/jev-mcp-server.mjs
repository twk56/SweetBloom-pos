#!/usr/bin/env node
import readline from 'node:readline';
import { askJev, reviewOrderWithJev } from '../src/jev.mjs';

const serverInfo = { name: 'sweetbloom-jev', version: '1.0.0' };
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); }
  catch { return; }
  if (!request.id) return;
  try { send({ jsonrpc: '2.0', id: request.id, result: await handle(request) }); }
  catch (error) { send({ jsonrpc: '2.0', id: request.id, error: { code: -32000, message: error.message } }); }
});

async function handle(request) {
  if (request.method === 'initialize') {
    return { protocolVersion: request.params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo, instructions: 'Use Jev for typed classification, routing and scoring. Never send secrets or personal customer data. Keep exact arithmetic and date comparisons in code.' };
  }
  if (request.method === 'ping') return {};
  if (request.method === 'tools/list') return { tools: toolsList() };
  if (request.method === 'tools/call') return callTool(request.params?.name, request.params?.arguments || {});
  throw new Error(`Unsupported method: ${request.method}`);
}

function toolsList() {
  return [
    {
      name: 'jev_decide',
      description: 'Send non-sensitive text or structured state to Jev and receive typed yes/no, choice, or score decisions with probabilities.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['state', 'questions'],
        properties: { state: {}, model: { type: 'string' }, questions: { type: 'object' } }
      }
    },
    {
      name: 'jev_order_priority',
      description: 'Classify the handling priority and production complexity of a bakery order without sending customer identity, phone, or address.',
      inputSchema: {
        type: 'object', additionalProperties: false, required: ['order'],
        properties: { order: { type: 'object' } }
      }
    }
  ];
}

async function callTool(name, args) {
  let result;
  if (name === 'jev_decide') result = await askJev(args);
  else if (name === 'jev_order_priority') result = await reviewOrderWithJev(args.order);
  else throw new Error(`Unknown tool: ${name}`);
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], structuredContent: result };
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
