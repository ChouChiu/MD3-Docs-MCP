import { closesFence, leadingFence, openFence } from "./fences.js";

const MIN_SPLIT_LIMIT = 100;

/** Paragraph-level units: blank-line separated, never inside a fenced code block. */
function paragraphAtoms(markdown: string): string[] {
  const atoms: string[] = [];
  let current: string[] = [];
  let fence: ReturnType<typeof openFence> | undefined;

  const flush = () => {
    const value = current.join("\n").trim();
    if (value) atoms.push(value);
    current = [];
  };

  for (const line of markdown.split("\n")) {
    const marker = leadingFence(line);
    if (marker) {
      if (!fence) fence = openFence(marker);
      else if (closesFence(line, fence)) fence = undefined;
    }
    if (!fence && line.trim() === "") flush();
    else current.push(line);
  }
  flush();
  return atoms;
}

function splitPlainText(value: string, limit: number): string[] {
  if (value.length <= limit) return [value];
  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > limit) {
    const window = remaining.slice(0, limit + 1);
    const splitAt = Math.max(
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf("; "),
      window.lastIndexOf(", "),
      window.lastIndexOf(" "),
    );
    // Prefer a natural boundary only when it does not waste half the budget.
    const end = splitAt >= Math.floor(limit * 0.5) ? Math.min(splitAt + 1, limit) : limit;
    parts.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function splitCodeText(value: string, limit: number): string[] {
  if (value.length <= limit) return [value];
  const parts: string[] = [];
  let remaining = value;
  while (remaining.length > limit) {
    const newline = remaining.lastIndexOf("\n", limit);
    if (newline > 0) {
      parts.push(remaining.slice(0, newline));
      remaining = remaining.slice(newline + 1);
    } else {
      parts.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
    }
  }
  if (remaining) parts.push(remaining);
  return parts;
}

/** Re-emit a fenced block per fragment so every page stays valid Markdown. */
function splitFencedCode(value: string, limit: number): string[] | undefined {
  const lines = value.split("\n");
  const opener = lines[0];
  const closer = lines.at(-1);
  const marker = opener === undefined ? undefined : leadingFence(opener);
  if (!opener || !closer || !marker) return undefined;
  if (!closesFence(closer, openFence(marker))) return undefined;
  const wrapperSize = opener.length + closer.length + 2;
  if (wrapperSize >= limit) return undefined;
  const bodyLimit = limit - wrapperSize;
  const body = lines.slice(1, -1).join("\n");
  return splitCodeText(body, bodyLimit).map((part) => `${opener}\n${part}\n${closer}`);
}

/** Repeat the header row on every fragment so tables stay parseable. */
function splitTable(value: string, limit: number): string[] | undefined {
  const lines = value.split("\n");
  const header = lines[0];
  const separator = lines[1];
  if (lines.length < 3 || !header?.includes("|") || !separator) return undefined;
  if (!/^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/.test(separator)) return undefined;

  const preamble = `${header}\n${separator}`;
  const parts: string[] = [];
  let current = preamble;
  for (const row of lines.slice(2)) {
    if (current !== preamble && `${current}\n${row}`.length > limit) {
      parts.push(current);
      current = `${preamble}\n${row}`;
    } else {
      current = `${current}\n${row}`;
    }
  }
  if (current !== preamble) parts.push(current);
  return parts.length > 0 && parts.every((part) => part.length <= limit) ? parts : undefined;
}

/**
 * Split Markdown into fragments no longer than `limit`, preferring paragraph, table, and
 * code-fence boundaries so a page never contains a half-rendered structure.
 */
export function splitMarkdownSafely(markdown: string, limit: number): string[] {
  if (limit < MIN_SPLIT_LIMIT) {
    throw new RangeError("Markdown split limit must be at least 100 characters");
  }
  const atoms = paragraphAtoms(markdown).flatMap((atom) => {
    if (atom.length <= limit) return [atom];
    return splitFencedCode(atom, limit) ?? splitTable(atom, limit) ?? splitPlainText(atom, limit);
  });

  const groups: string[] = [];
  let current = "";
  for (const atom of atoms) {
    const combined = current ? `${current}\n\n${atom}` : atom;
    if (combined.length > limit && current) {
      groups.push(current);
      current = atom;
    } else {
      current = combined;
    }
  }
  if (current) groups.push(current);
  return groups;
}
