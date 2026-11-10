/** Stored form of a person name: trimmed, every whitespace run (tabs, newlines, NBSP) -> one space. */
export const cleanName = (n: string): string => n.replace(/\s+/gu, " ").trim();

/** Case-insensitive person key of the cleaned name; ß -> ss like Python casefold() (other exotic folds differ, irrelevant for names here). */
export const nameKey = (n: string): string => cleanName(n).normalize("NFKC").toLowerCase().replace(/ß/g, "ss");
