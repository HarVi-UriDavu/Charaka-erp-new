export async function createPool(options = {}) {
  let Pool;
  try {
    ({ Pool } = await import("pg"));
  } catch {
    throw new Error("PostgreSQL driver missing. Run npm install before using db:migrate or the Postgres backend.");
  }
  const connectionString = options.connectionString || process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL backend commands.");
  return new Pool({ connectionString, max: options.max || 10 });
}

export async function withTransaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
