/** Case-insensitive person key; ß -> ss like Python casefold() (other exotic folds differ, irrelevant for names here). */
export const nameKey = (n: string): string => n.normalize("NFKC").toLowerCase().replace(/ß/g, "ss");
