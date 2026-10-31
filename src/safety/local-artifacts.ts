import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MAX_TEXT_BYTES, ScriptSchema } from './validation.js';
import { RouterOsLinter, type LintResult } from './linter.js';
import { ConfigSanitizer } from './sanitizer.js';

export interface LocalArtifact {
  name: string;
  content: string;
}

export function lintLocalFile(file: string): LintResult {
  if (path.extname(file).toLowerCase() !== '.rsc') throw new Error('Choose a .rsc configuration file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('Choose a regular configuration file');
    if (stat.size > MAX_TEXT_BYTES) throw new Error('Configuration exceeds 128 KiB');
    const buffer = Buffer.alloc(MAX_TEXT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const count = fs.readSync(fd, buffer, length, buffer.length - length, null);
      if (!count) break;
      length += count;
    }
    if (length > MAX_TEXT_BYTES) throw new Error('Configuration exceeds 128 KiB');
    const script = ScriptSchema.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
    return RouterOsLinter.lint(script);
  } finally { fs.closeSync(fd); }
}

export function lintReport(result: LintResult): string {
  return JSON.stringify(ConfigSanitizer.sanitizeJson(result), null, 2);
}

/** Export only into a newly created private directory to avoid overwriting user files. */
export function exportLocalArtifacts(destination: string, artifacts: readonly LocalArtifact[]): string {
  if (!artifacts.length) throw new Error('Generate a result before exporting');
  const target = path.resolve(destination);
  const parent = fs.realpathSync(path.dirname(target));
  const resolved = path.join(parent, path.basename(target));
  const names = new Set<string>();
  for (const artifact of artifacts) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(artifact.name) || names.has(artifact.name)) throw new Error('Invalid artifact name');
    names.add(artifact.name);
  }
  // Exclusive directory creation also rejects symlinks and competing exporters.
  fs.mkdirSync(resolved, { mode: 0o700 });
  const written: string[] = [];
  try {
    for (const artifact of artifacts) {
      const file = path.join(resolved, artifact.name);
      const fd = fs.openSync(file, 'wx', 0o600);
      written.push(file);
      try { fs.writeFileSync(fd, artifact.content, 'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
    const manifest = path.join(resolved, 'SHA256SUMS');
    if (!names.has('SHA256SUMS')) {
      fs.writeFileSync(manifest, artifacts.map((artifact) => `${crypto.createHash('sha256').update(artifact.content).digest('hex')}  ${artifact.name}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
      written.push(manifest);
    }
    return resolved;
  } catch (error) {
    for (const file of written.reverse()) fs.unlinkSync(file);
    fs.rmdirSync(resolved);
    throw error;
  }
}
