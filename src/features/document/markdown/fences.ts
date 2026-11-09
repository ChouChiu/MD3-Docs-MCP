export interface FenceState {
  character: string;
  length: number;
}

/** The fence run (```` or `~~~`) that opens a line, if the line opens one. */
export function leadingFence(line: string): string | undefined {
  return line.match(/^\s*(`{3,}|~{3,})/)?.[1];
}

export function openFence(marker: string): FenceState {
  return { character: marker[0] ?? "", length: marker.length };
}

/** A closing fence matches the opening character, is at least as long, and is alone. */
export function closesFence(line: string, fence: FenceState): boolean {
  const marker = leadingFence(line);
  return (
    marker !== undefined &&
    marker[0] === fence.character &&
    marker.length >= fence.length &&
    line.trim() === marker
  );
}
