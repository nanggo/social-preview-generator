import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const defaultProjectRoot = path.resolve(import.meta.dirname, '..');
const UNSUPPORTED_ACTION_REFERENCE = '<missing or unsupported action reference>';

function skipWhitespace(value, index) {
  let cursor = index;
  while (cursor < value.length && /\s/.test(value[cursor])) cursor += 1;
  return cursor;
}

function readQuotedScalar(value, index) {
  const quote = value[index];
  let cursor = index + 1;
  let result = '';

  while (cursor < value.length) {
    const character = value[cursor];
    if (character === quote) {
      if (quote === "'" && value[cursor + 1] === "'") {
        result += "'";
        cursor += 2;
        continue;
      }
      return { value: result, end: cursor + 1, closed: true };
    }

    if (quote === '"' && character === '\\') {
      const escaped = value[cursor + 1];
      const escapes = {
        '0': '\0',
        a: '\x07',
        b: '\b',
        t: '\t',
        n: '\n',
        v: '\v',
        f: '\f',
        r: '\r',
        e: '\x1b',
        ' ': ' ',
        '"': '"',
        '/': '/',
        '\\': '\\',
      };
      if (escaped in escapes) {
        result += escapes[escaped];
        cursor += 2;
        continue;
      }

      const hexLength = escaped === 'x' ? 2 : escaped === 'u' ? 4 : escaped === 'U' ? 8 : 0;
      if (hexLength > 0) {
        const hex = value.slice(cursor + 2, cursor + 2 + hexLength);
        if (new RegExp(`^[0-9a-fA-F]{${hexLength}}$`).test(hex)) {
          result += String.fromCodePoint(Number.parseInt(hex, 16));
          cursor += 2 + hexLength;
          continue;
        }
      }
    }

    result += character;
    cursor += 1;
  }

  return { value: result, end: cursor, closed: false };
}

function readPlainScalar(value, index, terminators) {
  let cursor = index;
  while (cursor < value.length && !terminators.test(value[cursor])) cursor += 1;
  return { value: value.slice(index, cursor), end: cursor, closed: true };
}

function readScalar(value, index, terminators) {
  if (value[index] === '"' || value[index] === "'") {
    return readQuotedScalar(value, index);
  }
  return readPlainScalar(value, index, terminators);
}

function skipYamlProperties(value, index) {
  let cursor = skipWhitespace(value, index);
  while (value[cursor] === '&' || value[cursor] === '!') {
    cursor += 1;
    while (cursor < value.length && !/[\s,{}\[\]]/.test(value[cursor])) cursor += 1;
    cursor = skipWhitespace(value, cursor);
  }
  return cursor;
}

function parseMappingAt(line, start, flow = false) {
  let cursor = skipWhitespace(line, start);
  if (line[cursor] === '?' && /\s/.test(line[cursor + 1] ?? '')) {
    cursor = skipWhitespace(line, cursor + 1);
  }
  cursor = skipYamlProperties(line, cursor);

  if (cursor >= line.length || line[cursor] === '#') return undefined;
  const key = readScalar(line, cursor, /[\s:,{}\[\]]/);
  if (!key.closed) {
    return { key: 'uses', reference: UNSUPPORTED_ACTION_REFERENCE, valueStart: key.end };
  }

  cursor = skipWhitespace(line, key.end);
  if (line[cursor] !== ':') {
    return key.value === 'uses'
      ? { key: key.value, reference: UNSUPPORTED_ACTION_REFERENCE, valueStart: cursor }
      : undefined;
  }

  // An alias can resolve to `uses` while hiding the semantic key from a
  // dependency-free scanner. Reject aliased mapping keys instead of guessing.
  if (key.value.startsWith('*')) {
    return { key: 'uses', reference: UNSUPPORTED_ACTION_REFERENCE, valueStart: cursor + 1 };
  }

  const valueStart = skipWhitespace(line, cursor + 1);
  if (key.value !== 'uses') return { key: key.value, valueStart };
  if (
    valueStart >= line.length ||
    line[valueStart] === '#' ||
    line[valueStart] === '}' ||
    line[valueStart] === ']'
  ) {
    return { key: key.value, reference: UNSUPPORTED_ACTION_REFERENCE, valueStart };
  }

  // `#` and `,` are valid inside block-context plain scalars when they are not
  // separated by whitespace. In flow collections only the comma/brackets are
  // structural terminators. Whitespace already covers YAML comment starts.
  const referenceTerminators = flow ? /[\s,}\]]/ : /\s/;
  const reference = readScalar(line, valueStart, referenceTerminators);
  return {
    key: key.value,
    reference: reference.closed && reference.value.length > 0
      ? reference.value
      : UNSUPPORTED_ACTION_REFERENCE,
    valueStart,
  };
}

function isYamlCommentStart(value, index) {
  return value[index] === '#' && (index === 0 || /\s/.test(value[index - 1]));
}

function isActionUsesContext(pathParts, fileKind) {
  if (fileKind === 'workflow') {
    if (pathParts[0] !== 'jobs') return false;
    if (pathParts.length === 2) return true;
    return pathParts.length === 3 && pathParts[2] === 'steps';
  }

  return pathParts[0] === 'runs' && pathParts.length === 2 && pathParts[1] === 'steps';
}

function hasUnclosedFlowCollection(value, start) {
  const expectedClosers = [];
  let cursor = start;

  while (cursor < value.length) {
    if (isYamlCommentStart(value, cursor)) break;
    if (value[cursor] === '"' || value[cursor] === "'") {
      const scalar = readQuotedScalar(value, cursor);
      if (!scalar.closed) return true;
      cursor = scalar.end;
      continue;
    }
    if (value[cursor] === '{') expectedClosers.push('}');
    if (value[cursor] === '[') expectedClosers.push(']');
    if (value[cursor] === '}' || value[cursor] === ']') {
      if (expectedClosers.at(-1) !== value[cursor]) return true;
      expectedClosers.pop();
      if (expectedClosers.length === 0) return false;
    }
    cursor += 1;
  }

  return expectedClosers.length > 0;
}

function scanFlowValue(line, start, pathParts, fileKind, references) {
  let cursor = skipYamlProperties(line, start);
  if (cursor >= line.length || isYamlCommentStart(line, cursor)) return line.length;
  if (line[cursor] === '*' && isActionUsesContext(pathParts, fileKind)) {
    // Whole-node aliases can import a hidden `uses` mapping from a non-action
    // schema location. Reject them at action-bearing job/step positions.
    references.push(UNSUPPORTED_ACTION_REFERENCE);
  }
  if (line[cursor] === '"' || line[cursor] === "'") {
    return readQuotedScalar(line, cursor).end;
  }
  if (line[cursor] === '{') {
    return scanFlowMapping(line, cursor, pathParts, fileKind, references);
  }
  if (line[cursor] === '[') {
    return scanFlowSequence(line, cursor, pathParts, fileKind, references);
  }

  while (cursor < line.length) {
    if (line[cursor] === ',' || line[cursor] === '}' || line[cursor] === ']') break;
    if (isYamlCommentStart(line, cursor)) return line.length;
    cursor += 1;
  }
  return cursor;
}

function scanFlowMapping(line, start, pathParts, fileKind, references) {
  let cursor = start + 1;
  while (cursor < line.length) {
    cursor = skipWhitespace(line, cursor);
    if (isYamlCommentStart(line, cursor)) return line.length;
    if (line[cursor] === '}') return cursor + 1;
    if (line[cursor] === ',') {
      cursor += 1;
      continue;
    }

    const mapping = parseMappingAt(line, cursor, true);
    if (!mapping) {
      const next = scanFlowValue(line, cursor, pathParts, fileKind, references);
      cursor = next > cursor ? next : cursor + 1;
      continue;
    }

    if (mapping.key === 'uses' && isActionUsesContext(pathParts, fileKind)) {
      references.push(mapping.reference);
    }
    const next = scanFlowValue(
      line,
      mapping.valueStart,
      [...pathParts, mapping.key],
      fileKind,
      references
    );
    cursor = next > cursor ? next : cursor + 1;
  }
  return cursor;
}

function scanFlowSequence(line, start, pathParts, fileKind, references) {
  let cursor = start + 1;
  while (cursor < line.length) {
    cursor = skipWhitespace(line, cursor);
    if (isYamlCommentStart(line, cursor)) return line.length;
    if (line[cursor] === ']') return cursor + 1;
    if (line[cursor] === ',') {
      cursor += 1;
      continue;
    }
    const next = scanFlowValue(line, cursor, pathParts, fileKind, references);
    cursor = next > cursor ? next : cursor + 1;
  }
  return cursor;
}

function findUsesReferencesInLine(line, pathParts, fileKind) {
  const references = [];
  let cursor = skipWhitespace(line, 0);

  if (line[cursor] === '-' && /\s/.test(line[cursor + 1] ?? '')) {
    cursor = skipWhitespace(line, cursor + 1);
  }
  cursor = skipYamlProperties(line, cursor);
  const indentation = cursor;

  if (line[cursor] === '*' && isActionUsesContext(pathParts, fileKind)) {
    references.push(UNSUPPORTED_ACTION_REFERENCE);
    return { references, indentation, blockScalar: false, mappingKey: undefined };
  }

  if (line[cursor] === '{' || line[cursor] === '[') {
    if (hasUnclosedFlowCollection(line, cursor)) {
      // This scanner deliberately supports flow collections only when their
      // complete structure is visible on one physical line. Otherwise path
      // context can cross lines and conceal an action reference.
      references.push(UNSUPPORTED_ACTION_REFERENCE);
      return { references, indentation, blockScalar: false, mappingKey: undefined };
    }
    scanFlowValue(line, cursor, pathParts, fileKind, references);
    return { references, indentation, blockScalar: false, mappingKey: undefined };
  }

  const mapping = parseMappingAt(line, cursor);
  if (
    mapping?.key === 'uses' &&
    isActionUsesContext(pathParts, fileKind)
  ) {
    references.push(mapping.reference);
  }
  const nestedValueStart = mapping
    ? skipYamlProperties(line, mapping.valueStart)
    : undefined;
  const nestedPath = mapping ? [...pathParts, mapping.key] : pathParts;
  if (
    line[nestedValueStart] === '*' &&
    isActionUsesContext(nestedPath, fileKind)
  ) {
    references.push(UNSUPPORTED_ACTION_REFERENCE);
  }
  if (line[nestedValueStart] === '{' || line[nestedValueStart] === '[') {
    if (hasUnclosedFlowCollection(line, nestedValueStart)) {
      references.push(UNSUPPORTED_ACTION_REFERENCE);
    } else {
      scanFlowValue(
        line,
        nestedValueStart,
        nestedPath,
        fileKind,
        references
      );
    }
  }

  const valueText = mapping ? line.slice(mapping.valueStart).trim() : '';
  return {
    references,
    indentation,
    blockScalar: /^[|>](?:[+-]?[1-9]?|[1-9][+-])(?:\s+#.*)?$/.test(valueText),
    mappingKey: mapping?.key === 'uses' ? undefined : mapping?.key,
  };
}

async function findYamlFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findYamlFiles(entryPath)));
    } else if (/\.ya?ml$/i.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

const SKIPPED_COMPOSITE_ACTION_DIRECTORIES = new Set([
  '.git',
  'coverage',
  'dist',
  'node_modules',
]);

async function findCompositeActionFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_COMPOSITE_ACTION_DIRECTORIES.has(entry.name)) {
        files.push(...(await findCompositeActionFiles(path.join(directory, entry.name))));
      }
      continue;
    }

    if (/^action\.ya?ml$/i.test(entry.name)) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}

export function isImmutableActionReference(reference) {
  if (reference.startsWith('./')) return true;
  if (reference.startsWith('docker://')) {
    return /^docker:\/\/[^\s]+@sha256:[0-9a-f]{64}$/.test(reference);
  }
  return /^[^@\s]+@[0-9a-f]{40}$/.test(reference);
}

export async function findActionPinViolations(projectRoot = defaultProjectRoot) {
  const workflowFiles = await findYamlFiles(path.join(projectRoot, '.github', 'workflows'));
  const compositeActionFiles = await findCompositeActionFiles(projectRoot);
  const targets = new Map([
    ...workflowFiles.map(filePath => [filePath, 'workflow']),
    ...compositeActionFiles.map(filePath => [filePath, 'composite']),
  ]);
  const violations = [];
  for (const [filePath, fileKind] of targets) {
    const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/);
    let blockScalarIndentation;
    const contextStack = [];
    lines.forEach((line, index) => {
      const indentation = line.search(/\S|$/);
      if (blockScalarIndentation !== undefined) {
        if (line.trim().length === 0 || indentation > blockScalarIndentation) return;
        blockScalarIndentation = undefined;
      }

      while (
        contextStack.length > 0 &&
        indentation <= contextStack[contextStack.length - 1].indentation
      ) {
        contextStack.pop();
      }

      const parsed = findUsesReferencesInLine(
        line,
        contextStack.map(entry => entry.key),
        fileKind
      );
      if (parsed.blockScalar) blockScalarIndentation = parsed.indentation;
      for (const reference of parsed.references) {
        if (!isImmutableActionReference(reference)) {
          violations.push(`${path.relative(projectRoot, filePath)}:${index + 1}: ${reference}`);
        }
      }
      if (parsed.mappingKey) {
        contextStack.push({ indentation: parsed.indentation, key: parsed.mappingKey });
      }
    });
  }
  return violations;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  const violations = await findActionPinViolations();
  if (violations.length > 0) {
    console.error('Mutable GitHub Action references found:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
  } else {
    console.log('All GitHub Action references are pinned to immutable revisions.');
  }
}
