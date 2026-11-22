import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * Resolve absolute or relative path against working directory.
 */
function resolvePath(targetPath, baseDir = process.cwd()) {
  return path.isAbsolute(targetPath) ? targetPath : path.resolve(baseDir, targetPath);
}

/**
 * Read file contents as UTF-8 string or buffer.
 */
export async function read(filePath, encoding = 'utf8') {
  const fullPath = resolvePath(filePath);
  try {
    return await fs.readFile(fullPath, encoding);
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`File not found: "${filePath}"`);
    }
    throw err;
  }
}

/**
 * Write file contents, creating parent directories automatically.
 */
export async function write(filePath, content, options = {}) {
  const fullPath = resolvePath(filePath);
  const dir = path.dirname(fullPath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(fullPath, content, options);
  return { path: filePath, fullPath, bytes: Buffer.byteLength(String(content)) };
}

/**
 * Surgical file edit by replacing old text with new text.
 */
export async function edit(filePath, oldText, newText, options = {}) {
  const fullPath = resolvePath(filePath);
  const current = await read(fullPath);

  if (!current.includes(oldText)) {
    throw new Error(
      `Cannot edit "${filePath}": target text not found in file.\n` +
      `Ensure whitespace and formatting match exactly.`
    );
  }

  const occurrences = current.split(oldText).length - 1;
  if (occurrences > 1 && !options.replaceAll) {
    throw new Error(
      `Cannot edit "${filePath}": target text matches ${occurrences} times.\n` +
      `Provide more surrounding context to disambiguate, or pass { replaceAll: true }.`
    );
  }

  const updated = options.replaceAll
    ? current.replaceAll(oldText, newText)
    : current.replace(oldText, newText);

  await fs.writeFile(fullPath, updated, 'utf8');

  return {
    path: filePath,
    occurrences,
    replaced: true
  };
}

/**
 * Patch file by applying a transformer function.
 */
export async function patch(filePath, transformer) {
  const current = await read(filePath);
  const updated = await transformer(current);
  if (updated !== current) {
    await write(filePath, updated);
    return { path: filePath, modified: true };
  }
  return { path: filePath, modified: false };
}

/**
 * Check if a path exists.
 */
export async function exists(targetPath) {
  try {
    await fs.access(resolvePath(targetPath));
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove file or directory recursively.
 */
export async function remove(targetPath) {
  const fullPath = resolvePath(targetPath);
  await fs.rm(fullPath, { recursive: true, force: true });
  return { path: targetPath, removed: true };
}

/**
 * Find files matching glob pattern.
 */
export async function glob(pattern, options = {}) {
  const cwd = options.cwd || process.cwd();
  const matches = [];
  
  if (typeof fs.glob === 'function') {
    for await (const entry of fs.glob(pattern, { cwd, ...options })) {
      matches.push(entry);
    }
  } else {
    // Fallback: simple recursive search if fs.glob not available
    const walk = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = path.join(dir, e.name);
        const rel = path.relative(cwd, full);
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') {
          await walk(full);
        } else if (e.isFile()) {
          matches.push(rel);
        }
      }
    };
    await walk(cwd);
  }
  return matches;
}

/**
 * List files and directories in a path.
 */
export async function list(targetDir = '.') {
  const fullPath = resolvePath(targetDir);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  return entries.map((e) => ({
    name: e.name,
    isDirectory: e.isDirectory(),
    isFile: e.isFile(),
    isSymbolicLink: e.isSymbolicLink()
  }));
}
