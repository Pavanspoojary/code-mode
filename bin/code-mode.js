#!/usr/bin/env node

import fs from 'node:fs/promises';
import readline from 'node:readline';
import { runCodeMode } from '../src/runner.js';
import { startMcpServer } from '../src/mcp.js';

const args = process.argv.slice(2);
const command = args[0] || 'help';

async function main() {
  switch (command) {
    case 'mcp': {
      startMcpServer();
      break;
    }

    case 'run': {
      const target = args[1];
      if (!target) {
        console.error('Error: "run" requires a file path or code string.');
        process.exit(1);
      }

      let codeToRun = target;
      try {
        const fileContent = await fs.readFile(target, 'utf8');
        codeToRun = fileContent;
      } catch {
        // Not a file, treated as inline code
      }

      const res = await runCodeMode(codeToRun);
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);

      if (!res.ok) {
        console.error(`Error: ${res.error}`);
        process.exit(1);
      } else if (res.result !== null && res.result !== undefined) {
        console.log(typeof res.result === 'object' ? JSON.stringify(res.result, null, 2) : res.result);
      }
      break;
    }

    case 'repl': {
      console.log('Open Code Mode REPL (type .exit or Ctrl+C to leave)');
      console.log('Globals: $, read, write, edit, patch, glob, list');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'code-mode> '
      });

      rl.prompt();

      rl.on('line', async (line) => {
        const input = line.trim();
        if (input === '.exit') {
          rl.close();
          return;
        }
        if (input) {
          try {
            const res = await runCodeMode(input);
            if (res.stdout) process.stdout.write(res.stdout);
            if (res.stderr) process.stderr.write(res.stderr);
            if (!res.ok) {
              console.error(`Error: ${res.error}`);
            } else if (res.result !== null && res.result !== undefined) {
              console.log(res.result);
            }
          } catch (e) {
            console.error(e.message);
          }
        }
        rl.prompt();
      });

      rl.on('close', () => {
        console.log('\nExiting Code Mode REPL.');
        process.exit(0);
      });
      break;
    }

    case 'help':
    default: {
      console.log(`
Open Code Mode (CLI)

Usage:
  code-mode mcp                 Start Model Context Protocol (MCP) server over stdio
  code-mode run "<code|file>"   Execute a Code Mode script or file
  code-mode repl                Launch interactive Code Mode evaluation REPL
  code-mode help                Show this help message
      `.trim());
      break;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
