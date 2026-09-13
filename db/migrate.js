import 'dotenv/config';
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPool, closeDatabase } from './database.js';

export async function applyMigrations(connection) {
    await connection.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
    const directory = new URL('./migrations/', import.meta.url);
    const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort();
    for (const name of files) {
        const sql = await readFile(new URL(name,directory), 'utf8');
        const checksum = createHash('sha256').update(sql).digest('hex');
        const { rows } = await connection.query('SELECT checksum FROM schema_migrations WHERE name=$1', [name]);
        if (rows.length) {
            if (rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
            continue;
        }
        await connection.query('BEGIN');
        try {
            await connection.query(sql);
            await connection.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [name,checksum]);
            await connection.query('COMMIT');
        } catch (error) { await connection.query('ROLLBACK'); throw new Error(`${name}: ${error.message}`); }
    }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const connection=await getPool().connect();
    try {
        await connection.query("SELECT pg_advisory_lock(hashtext('validatecall_migrations'))");
        await applyMigrations(connection);
        console.log('Database migrations are up to date.');
    } finally {
        await connection.query("SELECT pg_advisory_unlock(hashtext('validatecall_migrations'))");
        connection.release();
        await closeDatabase();
    }
}
