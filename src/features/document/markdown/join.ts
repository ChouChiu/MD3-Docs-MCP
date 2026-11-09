/** Join Markdown fragments with blank lines and normalize excess spacing. */
export function joinMarkdown(parts: readonly string[]): string {
  return parts
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
