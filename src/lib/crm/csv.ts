/**
 * Renders one CSV cell, neutralizing spreadsheet formulas.
 *
 * Leading whitespace and control characters are skipped when looking for the
 * formula lead. Spreadsheet applications ignore them, so a tab or a space
 * before an equals sign still evaluates as a formula, which is the standard
 * way this protection is bypassed. Inquiry fields are trimmed by their Zod
 * schema before they are stored, but this helper is exported and must not
 * rely on that to be safe.
 *
 * Order matters: the apostrophe is prefixed to the original text first, then
 * the whole value is quoted and its own quotes doubled, so the neutralizing
 * prefix cannot itself be escaped away. The stored value keeps its original
 * spacing; only the prefix is added.
 */
const FORMULA_LEAD = /^[=+\-@]/;

export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  let probe = text.trimStart();
  while (probe.length > 0 && probe.charCodeAt(0) < 0x20) {
    probe = probe.slice(1).trimStart();
  }
  const cell = FORMULA_LEAD.test(probe) ? `'${text}` : text;
  return `"${cell.replace(/"/g, '""')}"`;
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  const body = rows
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
  return `\uFEFF${body}\r\n`;
}
