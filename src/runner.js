import { createShell } from './shell.js';
import * as fsOps from './fs.js';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Truncate output string if it exceeds max allowed characters.
 */
function truncateOutput(str, maxChars = 50000) {
  if (!str || str.length <= maxChars) return str;
  const keep = Math.floor(maxChars / 2);
  const omitted = str.length - maxChars;
  return (
    str.slice(0, keep) +
    `\n\n... [Output truncated: ${omitted} characters omitted to protect context window] ...\n\n` +
    str.slice(-keep)
  );
}

/**
 * Executes a Code Mode script within an async runtime context.
 */
export async function runCodeMode(code, options = {}) {
  const startTime = Date.now();
  const cwd = options.cwd || process.cwd();
  const timeoutMs = options.timeoutMs ?? 600000; // 10 minutes default
  const maxOutputChars = options.maxOutputChars ?? 50000;

  const logs = [];
  let stdoutCaptured = '';
  let stderrCaptured = '';

  // Intercept console outputs
  const customConsole = {
    log(...args) {
      const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
      logs.push({ level: 'log', message: line, timestamp: Date.now() });
      stdoutCaptured += line + '\n';
    },
    info(...args) {
      const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
      logs.push({ level: 'info', message: line, timestamp: Date.now() });
      stdoutCaptured += line + '\n';
    },
    warn(...args) {
      const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
      logs.push({ level: 'warn', message: line, timestamp: Date.now() });
      stderrCaptured += line + '\n';
    },
    error(...args) {
      const line = args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ');
      logs.push({ level: 'error', message: line, timestamp: Date.now() });
      stderrCaptured += line + '\n';
    }
  };

  // Build sandboxed tool scope
  const $ = createShell({ cwd, timeout: timeoutMs, env: options.env });

  // Wrap fs operations to default to target cwd if relative
  const scopedFs = {
    read: (file, enc) => fsOps.read(file, enc),
    write: (file, content, opt) => fsOps.write(file, content, opt),
    edit: (file, oldText, newText, opt) => fsOps.edit(file, oldText, newText, opt),
    patch: (file, transformer) => fsOps.patch(file, transformer),
    exists: (file) => fsOps.exists(file),
    remove: (file) => fsOps.remove(file),
    glob: (pattern, opt) => fsOps.glob(pattern, { cwd, ...opt }),
    list: (dir) => fsOps.list(dir || cwd)
  };

  const sandboxContext = {
    $,
    ...scopedFs,
    console: customConsole,
    fetch: globalThis.fetch,
    URL: globalThis.URL,
    Buffer: globalThis.Buffer,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    mcp: options.mcp || {},
    env: { ...process.env, ...options.env }
  };

  // Prepare executable function body
  let preparedCode = code.trim();

  // If code does not contain a return statement, attempt to return the last expression
  if (!/\breturn\b/.test(preparedCode)) {
    const lines = preparedCode.split('\n');
    const lastLine = lines[lines.length - 1].trim();
    if (lastLine && !lastLine.startsWith('//') && !lastLine.startsWith('/*') && !lastLine.endsWith(';')) {
      lines[lines.length - 1] = `return (${lastLine});`;
      preparedCode = lines.join('\n');
    }
  }

  const argNames = Object.keys(sandboxContext);
  const argValues = Object.values(sandboxContext);

  let timedOut = false;
  let timer = null;

  try {
    const fn = new AsyncFunction(...argNames, preparedCode);

    const execPromise = fn(...argValues);

    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`Code execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    const result = await Promise.race([execPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    const executionTimeMs = Date.now() - startTime;

    return {
      ok: true,
      result: result !== undefined ? result : null,
      stdout: truncateOutput(stdoutCaptured, maxOutputChars),
      stderr: truncateOutput(stderrCaptured, maxOutputChars),
      logs,
      executionTimeMs,
      timedOut: false
    };
  } catch (err) {
    if (timer) clearTimeout(timer);
    const executionTimeMs = Date.now() - startTime;

    return {
      ok: false,
      error: err.message,
      stack: err.stack,
      stdout: truncateOutput(stdoutCaptured, maxOutputChars),
      stderr: truncateOutput(stderrCaptured, maxOutputChars),
      logs,
      executionTimeMs,
      timedOut
    };
  }
}

export default runCodeMode;
