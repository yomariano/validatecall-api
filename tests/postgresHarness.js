import { PGlite } from '@electric-sql/pglite';
import { applyMigrations } from '../db/migrate.js';
import { setTestPool } from '../db/database.js';

export async function testDatabase() {
    const pg = new PGlite({ parsers: { 1184: value => value, 1114: value => value } });
    const connection = {
        async query(sql, params) {
            const result = params ? await pg.query(sql,params) : (await pg.exec(sql)).at(-1) || {rows:[]};
            return { ...result, rowCount: result.affectedRows || result.rows?.length || 0 };
        },
        release() {},
        async connect() { return connection; },
    };
    await applyMigrations(connection);
    setTestPool(connection);
    return { pg, connection };
}
