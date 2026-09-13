import pg from 'pg';
// Preserve PostgreSQL timestamp precision for optimistic concurrency checks.
pg.types.setTypeParser(1184, value => value);
pg.types.setTypeParser(1114, value => value);

class SqlExpression { constructor(text) { this.text = text; } }

let pool;
let metadataPromise;
export function getPool() {
    if (!pool) {
        if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
        pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
    }
    return pool;
}
export function setTestPool(value) {
    if (process.env.NODE_ENV !== 'test') throw new Error('Test database override is disabled');
    pool = value;
    metadataPromise = undefined;
}
export async function closeDatabase() { if (pool?.end) await pool.end(); pool = undefined; metadataPromise = undefined; }
export function quote(name) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error('Invalid SQL identifier');
    return `"${name}"`;
}
async function metadata() {
    if (!metadataPromise) metadataPromise = (async () => {
        const columns = await getPool().query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public'");
        const foreign = await getPool().query(`SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
          FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema
          JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema
          WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema='public'`);
        return { columns: columns.rows, foreign: foreign.rows };
    })().catch(error => { metadataPromise = undefined; throw error; });
    return metadataPromise;
}
function splitFields(text) {
    let depth = 0, start = 0; const fields = [];
    for (let i=0;i<text.length;i++) {
        if (text[i] === '(') depth++;
        if (text[i] === ')') depth--;
        if (depth < 0) throw new Error('Invalid projection');
        if (text[i] === ',' && depth === 0) { fields.push(text.slice(start,i).trim()); start=i+1; }
    }
    if (depth) throw new Error('Invalid projection');
    fields.push(text.slice(start).trim());
    return fields.filter(Boolean);
}
const operations = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', ilike: 'ILIKE', like: 'LIKE', contains: '@>' };
class Query {
    constructor(database, table) {
        quote(table); this.database=database; this.table=table; this.filters=[]; this.orders=[];
        this.projection='*'; this.action='select'; this.returnRows=false;
    }
    select(fields='*', options={}) { this.projection=fields; this.options=options; this.returnRows=true; return this; }
    insert(rows) { this.action='insert'; this.rows=Array.isArray(rows)?rows:[rows]; return this; }
    upsert(rows, options={}) { this.insert(rows); this.conflict=options; return this; }
    update(row) { this.action='update'; this.rows=[row]; return this; }
    delete() { this.action='delete'; return this; }
    filter(column, op, value) { quote(column); this.filters.push({column,op,value}); return this; }
    eq(c,v){return this.filter(c,'eq',v);} neq(c,v){return this.filter(c,'neq',v);}
    gt(c,v){return this.filter(c,'gt',v);} gte(c,v){return this.filter(c,'gte',v);}
    lt(c,v){return this.filter(c,'lt',v);} lte(c,v){return this.filter(c,'lte',v);}
    ilike(c,v){return this.filter(c,'ilike',v);} like(c,v){return this.filter(c,'like',v);}
    is(c,v){return this.filter(c,'is',v);} in(c,v){return this.filter(c,'in',v);}
    contains(c,v){return this.filter(c,'contains',v);}
    not(c,op,v){quote(c);this.filters.push({column:c,op,value:v,negate:true});return this;}
    or(expression){this.filters.push({or:expression.split(',').map(term=>{const [column,op,...rest]=term.split('.');quote(column);return {column,op,value:rest.join('.')};})});return this;}
    order(column, options={}) { quote(column); this.orders.push({column, ...options}); return this; }
    limit(value){this.max=Number(value);return this;} range(start,end){this.offset=Number(start);this.max=Number(end)-Number(start)+1;return this;}
    single(){this.one='required';return this;} maybeSingle(){this.one='optional';return this;}
    then(resolve,reject){return this.execute().then(resolve,reject);}
    async execute() {
        try {
            const meta=await metadata();const values=[];const param=value=>{values.push(value);return `$${values.length}`;};
            const tableColumns=table=>meta.columns.filter(c=>c.table_name===table);
            const scope=(table,alias)=>{
                if (!this.database.userId) return '';
                const column=table==='profiles'?'id':tableColumns(table).some(c=>c.column_name==='user_id')?'user_id':null;
                if (!column) throw new Error(`Table ${table} is not available in a user-scoped query`);
                return `${alias}.${quote(column)}=${param(this.database.userId)}`;
            };
            const project=(table,alias,fields)=>splitFields(fields).map(field=>{
                if(field==='*')return `${alias}.*`;
                const nested=/^(?:(\w+):)?(\w+)(?:!(inner|\w+))?\((.*)\)$/s.exec(field);
                if(!nested){const parts=field.split(':');return `${alias}.${quote(parts.at(-1))}${parts.length===2?' AS '+quote(parts[0]):''}`;}
                const [,label,target,,inner]=nested;const childAlias=`q${values.length}_${alias}`;
                let rel=meta.foreign.find(f=>f.table_name===table&&f.foreign_table===target);let many=false;
                if(!rel){rel=meta.foreign.find(f=>f.table_name===target&&f.foreign_table===table);many=true;}
                if(!rel)throw new Error(`Unknown relationship ${table} -> ${target}`);
                const relation=many?`${childAlias}.${quote(rel.column_name)}=${alias}.${quote(rel.foreign_column)}`:`${childAlias}.${quote(rel.foreign_column)}=${alias}.${quote(rel.column_name)}`;
                const boundary=scope(target,childAlias);const where=relation+(boundary?' AND '+boundary:'');
                if(inner.trim()==='count')return `(SELECT json_build_array(json_build_object('count',count(*))) FROM ${quote(target)} ${childAlias} WHERE ${where}) AS ${quote(label||target)}`;
                const select=project(target,childAlias,inner);
                return many?`COALESCE((SELECT json_agg(nested_row) FROM (SELECT ${select} FROM ${quote(target)} ${childAlias} WHERE ${where}) nested_row),'[]'::json) AS ${quote(label||target)}`:
                    `(SELECT row_to_json(nested_row) FROM (SELECT ${select} FROM ${quote(target)} ${childAlias} WHERE ${where} LIMIT 1) nested_row) AS ${quote(label||target)}`;
            }).join(', ');
            const condition=f=>{
                if(f.or)return '('+f.or.map(condition).join(' OR ')+')';
                const col=`t.${quote(f.column)}`;let sql;
                if(f.op==='is'){if(![null,true,false].includes(f.value))throw new Error('Invalid IS value');sql=`${col} IS ${f.value===null?'NULL':f.value?'TRUE':'FALSE'}`;}
                else if(f.op==='in'){if(!Array.isArray(f.value))throw new Error('IN expects an array');sql=f.value.length?`${col} IN (${f.value.map(param).join(',')})`:'FALSE';}
                else {if(!operations[f.op])throw new Error('Unsupported query operator');sql=`${col} ${operations[f.op]} ${param(f.op==='contains'?JSON.stringify(f.value):f.value)}`;}
                return f.negate?`NOT (${sql})`:sql;
            };
            const rootScope=this.action==='insert'?'':scope(this.table,'t');const conditions=this.filters.map(condition);if(rootScope)conditions.push(rootScope);
            const where=conditions.length?' WHERE '+conditions.join(' AND '):'';
            let sql;
            if(this.action==='select') {
                sql=`SELECT ${project(this.table,'t',this.projection)} FROM ${quote(this.table)} t${where}`;
                if(this.orders.length)sql+=' ORDER BY '+this.orders.map(o=>`t.${quote(o.column)} ${o.ascending===false?'DESC':'ASC'}${o.nullsFirst===true?' NULLS FIRST':o.nullsFirst===false?' NULLS LAST':''}`).join(',');
                if(this.max!=null){if(!Number.isInteger(this.max)||this.max<0||this.max>10000)throw new Error('Invalid query limit');sql+=' LIMIT '+param(this.max);}
                if(this.offset!=null){if(!Number.isInteger(this.offset)||this.offset<0)throw new Error('Invalid query offset');sql+=' OFFSET '+param(this.offset);}
            } else if(this.action==='delete')sql=`DELETE FROM ${quote(this.table)} t${where}`;
            else {
                if(!this.rows.length)return {data:[],error:null,count:0};
                const cols=[...new Set(this.rows.flatMap(row=>Object.keys(row).filter(key=>row[key]!==undefined)))];cols.forEach(quote);
                if(!cols.length)throw new Error('Empty mutation');
                if(this.database.userId){
                    const owner=this.table==='profiles'?'id':'user_id';
                    for(const row of this.rows)if(row[owner]!=null&&row[owner]!==this.database.userId)throw new Error('Ownership mismatch');
                    if(this.action==='insert')for(const row of this.rows)row[owner]=this.database.userId;
                    if(this.action==='insert'&&!cols.includes(owner))cols.push(owner);
                }
                const bind=(col,value)=>{if(value instanceof SqlExpression)return value.text;const type=tableColumns(this.table).find(c=>c.column_name===col)?.data_type;return param(value!=null&&['json','jsonb'].includes(type)?JSON.stringify(value):value);};
                if(this.action==='update')sql=`UPDATE ${quote(this.table)} t SET ${cols.map(col=>`${quote(col)}=${bind(col,this.rows[0][col])}`).join(',')}${where}`;
                else {
                    sql=`INSERT INTO ${quote(this.table)} (${cols.map(quote).join(',')}) VALUES `+this.rows.map(row=>'('+cols.map(col=>row[col]===undefined?'DEFAULT':bind(col,row[col])).join(',')+')').join(',');
                    if(this.conflict){const keys=(this.conflict.onConflict||'id').split(',').map(s=>s.trim());const updates=cols.filter(col=>!keys.includes(col));sql+=` ON CONFLICT (${keys.map(quote).join(',')}) `+(this.conflict.ignoreDuplicates||!updates.length?'DO NOTHING':'DO UPDATE SET '+updates.map(col=>`${quote(col)}=EXCLUDED.${quote(col)}`).join(','));
                        if(this.database.userId && !this.conflict.ignoreDuplicates && updates.length) sql+=` WHERE ${quote(this.table)}.${quote(this.table==='profiles'?'id':'user_id')}=${param(this.database.userId)}`;
                    }
                }
            }
            if(this.action!=='select'&&this.returnRows)sql+=' RETURNING '+(this.projection==='*'?'*':splitFields(this.projection).map(quote).join(','));
            const result=await getPool().query(sql,values);
            let count=null;
            if(this.options?.count==='exact'){
                // Count the unpaginated result with the same predicates. Remove pagination parameters.
                const countValues=values.slice(0, values.length-(this.max!=null?1:0)-(this.offset!=null?1:0));
                // Projections can introduce scoped relation parameters; count keeps all placeholders valid.
                const countSql=`SELECT count(*)::int AS count FROM (${sql.replace(/ LIMIT \$\d+(?: OFFSET \$\d+)?$/,'').replace(/ OFFSET \$\d+$/,'')}) counted`;
                count=(await getPool().query(countSql,countValues)).rows[0].count;
            }
            if(this.one&&(result.rows.length>1||(this.one==='required'&&!result.rows.length)))return {data:null,error:{code:'PGRST116',message:'Expected one row'},count};
            return {data:this.options?.head?null:this.one?(result.rows[0]||null):this.action==='select'||this.returnRows?result.rows:null,error:null,count};
        } catch(error){return {data:null,error:{message:error.message,code:error.code||'DATABASE_ERROR'},count:null};}
    }
}
export function createDatabase(userId=null) {
    return {
        userId,
        sql(strings, ...identifiers) { return new SqlExpression(strings.reduce((text, part, index) => text + part + (index < identifiers.length ? quote(identifiers[index]) : ''), '')); },
        from(table){return new Query(this,table);},
        forUser(id){if(!id)throw new Error('User ID required');return createDatabase(id);},
        query(text,values){return getPool().query(text,values);},
        async rpc(name,args={}){
            try {
                if(userId)throw new Error('Stored procedures are server-only');
                const values=Object.values(args);const params=Object.keys(args).map((key,i)=>`${quote(key)} => $${i+1}`).join(',');
                const result=await getPool().query(`SELECT * FROM ${quote(name)}(${params})`,values);
                const row=result.rows[0];return {data:row&&Object.keys(row).length===1&&Object.hasOwn(row,name)?row[name]:result.rows,error:null};
            }catch(error){return {data:null,error:{message:error.message,code:error.code}};}
        },
    };
}
export const database=createDatabase();
