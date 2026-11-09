/** Lowercase kebab-case form used by canonical MD3 paths and section matching. */
export function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}

/** Sentence-case label derived from a kebab-case path segment. */
export function humanize(value: string): string {
  return value
    .split("-")
    .map((word) => (word ? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}` : word))
    .join(" ");
}

/** Loose comparison key for headings: case, separator, and surrounding space insensitive. */
export function normalizeHeading(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, " ");
}
