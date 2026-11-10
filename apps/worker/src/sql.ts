/** Pure SQL-text helpers for the generated seed/import files (one statement per line: D1 exec is line based). */
export const q = (s: string): string => `'${s.replace(/[\r\n]+/g, " ").replace(/'/g, "''")}'`;
