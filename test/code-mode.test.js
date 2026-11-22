import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  $,
  read,
  write,
  edit,
  patch,
  exists,
  remove,
  glob,
  runCodeMode,
  handleMcpRequest,
  toAnthropicTool,
  toOpenAITool,
  toGeminiTool,
  toVercelAITool
} from '../src/index.js';

const TEST_DIR = path.resolve('test-tmp');

describe('Open Code Mode Test Suite', () => {
  before(async () => {
    await fs.mkdir(TEST_DIR, { recursive: true });
  });

  after(async () => {
    await fs.rm(TEST_DIR, { recursive: true, force: true });
  });

  describe('Shell execution ($)', () => {
    test('executes command and extracts text', async () => {
      const out = await $`echo "open code mode"`.text();
      assert.equal(out, 'open code mode');
    });

    test('escapes interpolated arguments', async () => {
      const phrase = 'hello "world" & $foo';
      const out = await $`printf "%s" ${phrase}`.text();
      assert.equal(out, phrase);
    });

    test('extracts lines array', async () => {
      const lines = await $`printf "line1\nline2\nline3"`.lines();
      assert.deepEqual(lines, ['line1', 'line2', 'line3']);
    });

    test('nothrow suppresses non-zero exit error', async () => {
      const res = await $`exit 42`.nothrow();
      assert.equal(res.exitCode, 42);
      assert.equal(res.ok, false);
    });

    test('respects scoped cwd', async () => {
      const current = await $.cwd(TEST_DIR)`pwd`.text();
      assert.equal(path.resolve(current), TEST_DIR);
    });
  });

  describe('Filesystem operations', () => {
    test('write, read, edit, patch, and exists', async () => {
      const file = path.join(TEST_DIR, 'nested/demo.txt');

      // 1. write
      await write(file, 'initial content here');
      assert.equal(await exists(file), true);

      // 2. read
      const content = await read(file);
      assert.equal(content, 'initial content here');

      // 3. edit
      const editRes = await edit(file, 'initial', 'updated');
      assert.equal(editRes.replaced, true);
      assert.equal(await read(file), 'updated content here');

      // 4. patch
      await patch(file, (prev) => prev.toUpperCase());
      assert.equal(await read(file), 'UPDATED CONTENT HERE');

      // 5. remove
      await remove(file);
      assert.equal(await exists(file), false);
    });
  });

  describe('Code Mode Runner', () => {
    test('executes composite multi-step script', async () => {
      const testFile = path.join(TEST_DIR, 'script-demo.txt');
      const script = `
        await write('${testFile}', 'version 1.0.0');
        await edit('${testFile}', '1.0.0', '2.0.0');
        const finalContent = await read('${testFile}');
        console.log('Processed successfully');
        return { success: true, version: finalContent.split(' ')[1] };
      `;

      const res = await runCodeMode(script, { cwd: TEST_DIR });
      assert.equal(res.ok, true);
      assert.deepEqual(res.result, { success: true, version: '2.0.0' });
      assert.match(res.stdout, /Processed successfully/);
    });

    test('handles runtime error gracefully without crashing', async () => {
      const script = `throw new Error("test failure inside script");`;
      const res = await runCodeMode(script);
      assert.equal(res.ok, false);
      assert.match(res.error, /test failure inside script/);
    });

    test('handles timeout protection', async () => {
      const script = `await new Promise((r) => setTimeout(r, 500));`;
      const res = await runCodeMode(script, { timeoutMs: 50 });
      assert.equal(res.ok, false);
      assert.match(res.error, /timed out/);
    });
  });

  describe('Model Context Protocol (MCP) Interface', () => {
    test('responds to initialize', async () => {
      const res = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {}
      });
      assert.equal(res.result.serverInfo.name, 'open-code-mode');
    });

    test('lists code_mode tool in tools/list', async () => {
      const res = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {}
      });
      const toolNames = res.result.tools.map((t) => t.name);
      assert.ok(toolNames.includes('code_mode'));
    });

    test('executes tools/call for code_mode', async () => {
      const res = await handleMcpRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: {
          name: 'code_mode',
          arguments: {
            code: 'return 100 + 42;'
          }
        }
      });
      assert.equal(res.result.isError, false);
      const parsed = JSON.parse(res.result.content[0].text);
      assert.equal(parsed.result, 142);
    });
  });

  describe('Agent Adapters', () => {
    test('generates valid tool schemas', () => {
      const anthropic = toAnthropicTool();
      assert.equal(anthropic.name, 'code_mode');
      assert.ok(anthropic.input_schema);

      const openAI = toOpenAITool();
      assert.equal(openAI.function.name, 'code_mode');

      const gemini = toGeminiTool();
      assert.equal(gemini.functionDeclarations[0].name, 'code_mode');

      const vercel = toVercelAITool();
      assert.equal(typeof vercel.execute, 'function');
    });
  });
});
