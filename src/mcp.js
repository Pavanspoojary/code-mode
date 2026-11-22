import readline from 'node:readline';
import { runCodeMode } from './runner.js';

export const CODE_MODE_TOOL_DEF = {
  name: 'code_mode',
  description:
    'Execute JavaScript code in a local execution environment with built-in async shell ($), filesystem (read, edit, write, patch, exists, glob, list), and MCP tools. ' +
    'Use this tool to compose multi-step shell commands, searches, surgical edits, tests, and data filtering in a single turn without wasting tokens or latency on multiple roundtrips.\n\n' +
    'Available globals in your script:\n' +
    '- await $`cmd`: executes shell command; methods: .text(), .lines(), .json(), .nothrow(), .cwd(path)\n' +
    '- await read(path): read file content\n' +
    '- await write(path, content): write file with auto-created directories\n' +
    '- await edit(path, oldText, newText): surgical exact text replacement\n' +
    '- await patch(path, (prev) => next): functional content transformer\n' +
    '- await exists(path): check existence\n' +
    '- await glob(pattern): list files matching glob\n' +
    '- await list(dir): list directory contents\n' +
    '- console.log(...): capture logs\n' +
    '- return <value>: return distilled outcome to context',
  inputSchema: {
    type: 'object',
    properties: {
      code: {
        type: 'string',
        description: 'The JavaScript code to execute in Code Mode.'
      },
      timeoutMs: {
        type: 'number',
        description: 'Optional execution timeout in milliseconds (default: 600000 ms).'
      }
    },
    required: ['code']
  }
};

/**
 * Handle a JSON-RPC request for the MCP server.
 */
export async function handleMcpRequest(request, options = {}) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'open-code-mode',
            version: '0.1.0'
          }
        }
      };

    case 'notifications/initialized':
      return null; // Notifications require no response

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: [CODE_MODE_TOOL_DEF]
        }
      };

    case 'tools/call': {
      const toolName = params?.name;
      if (toolName !== 'code_mode') {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Tool not found: ${toolName}`
          }
        };
      }

      const args = params?.arguments || {};
      const code = args.code;
      const timeoutMs = args.timeoutMs;

      if (!code || typeof code !== 'string') {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: 'Error: missing or invalid "code" parameter.' }],
            isError: true
          }
        };
      }

      const execResult = await runCodeMode(code, {
        cwd: options.cwd || process.cwd(),
        timeoutMs: timeoutMs || options.timeoutMs
      });

      let textOutput = '';
      if (!execResult.ok) {
        textOutput = `Error: ${execResult.error}\n\nStdout:\n${execResult.stdout}\n\nStderr:\n${execResult.stderr}`;
      } else {
        const hasResult = execResult.result !== null && execResult.result !== undefined;
        textOutput = JSON.stringify(
          {
            ok: true,
            result: hasResult ? execResult.result : '(executed with no return value)',
            stdout: execResult.stdout || undefined,
            stderr: execResult.stderr || undefined,
            executionTimeMs: execResult.executionTimeMs
          },
          null,
          2
        );
      }

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: textOutput
            }
          ],
          isError: !execResult.ok
        }
      };
    }

    default:
      if (id !== undefined) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `Method not found: ${method}`
          }
        };
      }
      return null;
  }
}

/**
 * Start standard MCP server reading from process.stdin and writing to process.stdout.
 */
export function startMcpServer(options = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const request = JSON.parse(trimmed);
      const response = await handleMcpRequest(request, options);
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      process.stdout.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${err.message}`
          }
        }) + '\n'
      );
    }
  });

  process.stderr.write('Open Code Mode MCP server running on stdio.\n');
}
