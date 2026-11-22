import { spawn } from 'node:child_process';

/**
 * Format argument safely for shell execution.
 */
function escapeArg(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (Array.isArray(val)) return val.map(escapeArg).join(' ');
  const str = String(val);
  // If safe unquoted token, return as is
  if (/^[a-zA-Z0-9_\.\-\/=:@]+$/.test(str)) return str;
  // Single-quote escape
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

/**
 * Shell command execution promise with fluent helpers.
 */
class ShellPromise extends Promise {
  constructor(executor, state = {}) {
    let resolveRef;
    let rejectRef;
    super((resolve, reject) => {
      resolveRef = resolve;
      rejectRef = reject;
      if (executor) executor(resolve, reject);
    });
    this._resolve = resolveRef;
    this._reject = rejectRef;
    this._state = state;
  }

  static create(command, options = {}) {
    let childProc = null;
    let nothrow = options.nothrow || false;
    const cwd = options.cwd || process.cwd();
    const timeout = options.timeout || 600000; // 10 minutes default

    const run = () =>
      new Promise((resolve, reject) => {
        const shell = process.platform === 'win32' ? 'powershell.exe' : '/bin/sh';
        const shellArgs = process.platform === 'win32' ? ['-Command', command] : ['-c', command];

        childProc = spawn(shell, shellArgs, {
          cwd,
          env: { ...process.env, ...options.env },
          stdio: ['pipe', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = timeout > 0 ? setTimeout(() => {
          timedOut = true;
          childProc.kill('SIGTERM');
        }, timeout) : null;

        childProc.stdout.on('data', (d) => { stdout += d.toString(); });
        childProc.stderr.on('data', (d) => { stderr += d.toString(); });

        childProc.on('error', (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        });

        childProc.on('close', (code, signal) => {
          if (timer) clearTimeout(timer);
          const result = {
            command,
            stdout,
            stderr,
            exitCode: code ?? (signal ? 1 : 0),
            signal,
            ok: code === 0,
            timedOut
          };

          if (result.ok || nothrow) {
            resolve(result);
          } else {
            const err = new Error(
              `Command failed with exit code ${result.exitCode}: ${command}\n${stderr || stdout}`
            );
            err.result = result;
            reject(err);
          }
        });
      });

    // Lazy execution on await/then
    let innerPromise = null;
    const getPromise = () => {
      if (!innerPromise) innerPromise = run();
      return innerPromise;
    };

    const fluent = {
      then(onFulfilled, onRejected) {
        return getPromise().then(onFulfilled, onRejected);
      },
      catch(onRejected) {
        return getPromise().catch(onRejected);
      },
      finally(onFinally) {
        return getPromise().finally(onFinally);
      },
      nothrow() {
        nothrow = true;
        return fluent;
      },
      cwd(newCwd) {
        options.cwd = newCwd;
        return fluent;
      },
      async text() {
        const res = await fluent;
        return res.stdout.trim();
      },
      async lines() {
        const res = await fluent;
        return res.stdout
          .trim()
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
      },
      async json() {
        const res = await fluent;
        return JSON.parse(res.stdout);
      },
      kill(sig = 'SIGTERM') {
        if (childProc) childProc.kill(sig);
      }
    };

    return fluent;
  }
}

/**
 * Shell template literal builder ($`...`)
 */
export function createShell(defaultOptions = {}) {
  function $(pieces, ...args) {
    if (typeof pieces === 'string') {
      return ShellPromise.create(pieces, defaultOptions);
    }

    let command = '';
    for (let i = 0; i < pieces.length; i++) {
      command += pieces[i];
      if (i < args.length) {
        command += escapeArg(args[i]);
      }
    }

    return ShellPromise.create(command.trim(), defaultOptions);
  }

  $.cwd = (dir) => createShell({ ...defaultOptions, cwd: dir });
  $.env = (env) => createShell({ ...defaultOptions, env: { ...defaultOptions.env, ...env } });
  $.timeout = (ms) => createShell({ ...defaultOptions, timeout: ms });

  return $;
}

export const $ = createShell();
export default $;
