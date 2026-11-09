/** Escape a value so it cannot break out of a Markdown table cell. */
function tableCell(value: string): string {
  return value
    .replaceAll("|", "\\|")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replace(/\s*\r?\n\s*/g, " ");
}

function connectionOrder(value: unknown): number {
  const order = Number((value as { orderInComponent?: unknown } | null)?.orderInComponent ?? 0);
  return Number.isFinite(order) ? order : 0;
}

/** Render one `designSystems` resource table as a Markdown block plus a connection table. */
export function renderResource(resource: unknown): string {
  if (!resource || typeof resource !== "object") return "";
  const value = resource as Record<string, unknown>;
  const lines: string[] = [];
  if (typeof value.displayName === "string") lines.push(`**${value.displayName}**`);
  if (typeof value.definition === "string") lines.push(value.definition);
  if (Array.isArray(value.connections)) {
    lines.push("| Resource | Type | Status |", "| --- | --- | --- |");
    const connections = [...value.connections].sort(
      (left, right) => connectionOrder(left) - connectionOrder(right),
    );
    for (const connection of connections) {
      if (!connection || typeof connection !== "object") continue;
      const item = connection as Record<string, unknown>;
      const label = tableCell(String(item.displayName ?? "Resource"));
      const url = typeof item.resourceUrl === "string" ? item.resourceUrl : undefined;
      const name = url ? `[${label}](${url})` : label;
      lines.push(
        `| ${name} | ${tableCell(String(item.resourceType ?? "").replaceAll("_", " "))} | ${tableCell(String(item.status ?? ""))} |`,
      );
    }
  }
  return lines.join("\n");
}
