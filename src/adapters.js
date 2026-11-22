import { CODE_MODE_TOOL_DEF } from './mcp.js';
import { runCodeMode } from './runner.js';

export const CODE_MODE_SYSTEM_PROMPT = `
# Code Mode (Programmatic Tool Execution)

You have access to a special tool named \`code_mode\`.
Instead of issuing multiple individual tool calls turn-by-turn (such as running grep, reading a file, editing it, running another command, and waiting for each response), you write an executable JavaScript script that composes these actions programmatically in a single step.

## Available In-Scope Functions:
- \`await $\`cmd\`\`: Runs a shell command.
  - \`.text()\`: Returns trimmed stdout as a string.
  - \`.lines()\`: Returns non-empty stdout lines as an array.
  - \`.json()\`: Parses stdout as JSON.
  - \`.nothrow()\`: Suppresses non-zero exit errors.
  - \`.cwd(path)\`: Runs in a specific directory.
- \`await read(filePath, encoding = 'utf8')\`: Reads a file.
- \`await write(filePath, content)\`: Writes a file (auto-creates directories).
- \`await edit(filePath, oldText, newText, options?)\`: Surgically replaces exact text.
- \`await patch(filePath, (content) => newContent)\`: Modifies file with a transformer.
- \`await exists(path)\`: Returns boolean.
- \`await glob(pattern)\`: Finds files matching pattern.
- \`await list(dir)\`: Lists directory entries.
- \`console.log(...)\`: Logs information captured in output.
- \`return <value>\`: Returns the final structured outcome to your context.

## When to use Code Mode:
- Searching multiple files and reading only matching matches (filters out noise before hitting context).
- Multi-file refactorings or repetitive updates.
- Running a test suite or build, inspecting errors, and conditionally fixing without roundtrips.
`.trim();

/**
 * Anthropic Tool definition format.
 */
export function toAnthropicTool() {
  return {
    name: CODE_MODE_TOOL_DEF.name,
    description: CODE_MODE_TOOL_DEF.description,
    input_schema: CODE_MODE_TOOL_DEF.inputSchema
  };
}

/**
 * OpenAI Tool definition format (compatible with OpenAI, Groq, Ollama, DeepSeek).
 */
export function toOpenAITool() {
  return {
    type: 'function',
    function: {
      name: CODE_MODE_TOOL_DEF.name,
      description: CODE_MODE_TOOL_DEF.description,
      parameters: CODE_MODE_TOOL_DEF.inputSchema
    }
  };
}

/**
 * Google Gemini Tool definition format.
 */
export function toGeminiTool() {
  return {
    functionDeclarations: [
      {
        name: CODE_MODE_TOOL_DEF.name,
        description: CODE_MODE_TOOL_DEF.description,
        parameters: CODE_MODE_TOOL_DEF.inputSchema
      }
    ]
  };
}

/**
 * Vercel AI SDK Tool definition with execute function.
 */
export function toVercelAITool(options = {}) {
  return {
    description: CODE_MODE_TOOL_DEF.description,
    parameters: CODE_MODE_TOOL_DEF.inputSchema,
    execute: async ({ code, timeoutMs }) => {
      return await runCodeMode(code, { ...options, timeoutMs });
    }
  };
}
