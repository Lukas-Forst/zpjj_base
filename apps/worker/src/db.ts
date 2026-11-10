export function stmt(db: D1Database, sql: string, ...p: unknown[]): D1PreparedStatement {
  return db.prepare(sql).bind(...p);
}
export async function all<T>(db: D1Database, sql: string, ...p: unknown[]): Promise<T[]> {
  return (await stmt(db, sql, ...p).all<T>()).results;
}
export function first<T>(db: D1Database, sql: string, ...p: unknown[]): Promise<T | null> {
  return stmt(db, sql, ...p).first<T>();
}
export function run(db: D1Database, sql: string, ...p: unknown[]): Promise<D1Result> {
  return stmt(db, sql, ...p).run();
}
/** One atomic batch: D1 rolls back all statements if one fails. */
export function batch(db: D1Database, stmts: D1PreparedStatement[]): Promise<D1Result[]> {
  return db.batch(stmts);
}
