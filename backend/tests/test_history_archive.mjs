// Run with PGLITE_MODULE pointing to @electric-sql/pglite/dist/index.js.
// Executes real PostgreSQL SQL, functions, triggers and transactions in isolation.
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE produce_prices (
 row_hash text PRIMARY KEY, report_date date, market text, market_type text,
 source_report text, commodity_type text, commodity text, variety text, origin text,
 package text, size text, grade text, quality text, quality_note text, organic boolean,
 properties text, appearance text, condition text, notes text, price_qualifier text,
 price_low numeric(8,2), price_high numeric(8,2), price_mostly_low numeric(8,2),
 price_mostly_high numeric(8,2), source_record jsonb, updated_at timestamptz
);`);
const migration=readFileSync(new URL('../migrations/008_price_history.sql',import.meta.url),'utf8');
await db.exec(migration);
const scalar=async sql=>(await db.query(sql)).rows[0].v;
const today=await scalar(`SELECT ((now() AT TIME ZONE 'America/New_York')::date)::text AS v`);
const quote={row_hash:'hass-48',report_date:today,market:'New York',market_type:'terminal',source_report:'NX_FV010',commodity_type:'fruits',commodity:'Avocados',variety:'HASS',origin:'Mexico',package:'cartons 2 layer',size:'48s',grade:null,organic:false,price_low:32.10,price_high:36.20,price_mostly_low:33,price_mostly_high:35,source_record:{low_price:'32.10',high_price:'36.20',report_date:today.slice(5,7)+'/'+today.slice(8,10)+'/'+today.slice(0,4)}};
async function put(q){
 if(q.report_date)q={...q,source_record:{...q.source_record,report_date:q.report_date.slice(5,7)+'/'+q.report_date.slice(8,10)+'/'+q.report_date.slice(0,4)}};
 await db.query(`INSERT INTO produce_prices SELECT * FROM jsonb_populate_record(NULL::produce_prices,$1::jsonb)
 ON CONFLICT (row_hash) DO UPDATE SET price_low=EXCLUDED.price_low,price_high=EXCLUDED.price_high,
 price_mostly_low=EXCLUDED.price_mostly_low,price_mostly_high=EXCLUDED.price_mostly_high,
 source_record=EXCLUDED.source_record,updated_at=EXCLUDED.updated_at`,[JSON.stringify(q)]);
}
const read=async(id='hass-48',days=365)=>(await db.query('SELECT read_price_history($1,$2) AS v',[id,days])).rows[0].v;
const count=()=>scalar('SELECT count(*)::int AS v FROM price_history_revisions');
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
await check('excludes pre-launch reports even when imported today',async()=>{
 await put({...quote,row_hash:'old',report_date:'2026-09-19'});assert.equal(await count(),0);
 assert.deepEqual((await read('old')).observations,[]);
});
await check('transactional capture preserves exact decimals, mostly, source and date',async()=>{
 await put(quote);const r=(await read()).observations[0];assert.equal(r.price_low,32.10);assert.equal(r.price_high,36.20);assert.equal(r.price_mostly_low,33);assert.deepEqual(r.source_record,quote.source_record);assert.equal(r.report_date,today);
});
await check('retries and bookkeeping timestamps do not duplicate archive',async()=>{
 await put(quote);await put({...quote,updated_at:new Date().toISOString()});assert.equal(await count(),1);
});
await check('correction is appended, original retained, chart returns latest only',async()=>{
 await put({...quote,price_high:38});assert.equal(await count(),2);const h=await read();assert.equal(h.observations.length,1);assert.equal(h.observations[0].price_high,38);
 assert.equal(await scalar('SELECT (quote->>\'price_high\')::numeric AS v FROM price_history_revisions ORDER BY revision_id LIMIT 1'), '36.20');
});
await check('a correction reverting to the original value is retained',async()=>{
 await put(quote);assert.equal(await count(),3);assert.equal((await read()).observations[0].price_high,36.20);
});
await check('origin, size, organic, pack, grade, quality and report never mix',async()=>{
 for(const [field,value] of Object.entries({origin:'Peru',size:'60s',organic:true,package:'bags',grade:'Class I',quality:'Fine',quality_note:'Fair',properties:'Red',appearance:'Fine appearance',condition:'Poor',price_qualifier:'few',market:'Boston',source_report:'OTHER'})){
   await put({...quote,row_hash:'other-'+field,[field]:value,price_low:70,price_high:80,price_mostly_low:null,price_mostly_high:null});
   assert.equal((await read('other-'+field)).observations.length,1);
 }
 assert.equal((await read()).observations.length,1);assert.equal((await read()).observations[0].price_low,32.10);
});
await check('multiple report dates accumulate chronologically without fabricated days',async()=>{
 // Widen the cutoff only in this isolated fixture to test multiple dates today.
 await db.exec("UPDATE price_history_settings SET start_date='2026-09-01'");
 await put({...quote,row_hash:'prior-day',report_date:'2026-09-18',price_low:30,price_high:32});
 const h=await read();assert.equal(h.observations.length,2);assert.equal(h.observations[0].report_date,'2026-09-18');assert.equal((await read('hass-48',1)).observations.length,1);
});
await check('qualified prices do not create a new series on every price change',async()=>{
 await put({...quote,row_hash:'few-a',notes:'few 32.00-36.00',price_qualifier:'few',report_date:'2026-09-18'});
 await put({...quote,row_hash:'few-b',notes:'few 34.00-38.00',price_qualifier:'few',price_low:34,price_high:38});
 assert.equal((await read('few-b')).observations.length,2);
});
await check('raw source dates cannot be replaced by the import date',async()=>{
 await assert.rejects(db.query('SELECT capture_price_history($1)',[JSON.stringify({...quote,source_record:{report_date:'bad'}})]),/original USDA/);
});
await check('future dates and reversed/negative prices roll back current and history writes',async()=>{
 const before=await count();
 for(const patch of [{report_date:'2099-01-01'},{report_date:null},{price_low:-1},{price_low:40},{price_mostly_low:40}]){
   await assert.rejects(put({...quote,...patch,row_hash:'invalid'}));
 }
 assert.equal(await count(),before);assert.equal(await scalar("SELECT count(*)::int AS v FROM produce_prices WHERE row_hash='invalid'"),0);
});
await check('deleting current prices does not delete archive or break historical lookup',async()=>{
 await db.exec("DELETE FROM produce_prices WHERE row_hash='hass-48'");assert.equal((await read()).observations.length,2);
});
await check('archive cannot be updated, deleted, or truncated',async()=>{
 for(const sql of ['UPDATE price_history_revisions SET quote=quote','DELETE FROM price_history_revisions','TRUNCATE price_history_revisions'])await assert.rejects(db.exec(sql),/append-only/);
});
await check('anonymous and signed-in users cannot write history or invoke capture',async()=>{
 await db.exec('SET ROLE authenticated');
 await assert.rejects(db.exec("SELECT capture_price_history('{}')"),/permission denied/);
 await assert.rejects(db.exec('DELETE FROM price_history_revisions'),/permission denied/);
 await db.exec('RESET ROLE');
});
await check('missing quote is distinct from an empty series',async()=>assert.equal((await read('missing')).found,false));
await check('migration rerun is safe and preserves launch cutoff',async()=>{
 await db.exec(migration);assert.equal((await read()).start_date,'2026-09-01');
});
if(process.env.QUOTE_FIXTURE_PATH)await check('379 captured USDA quotes retain separate exact series and prices',async()=>{
 const quotes=JSON.parse(readFileSync(process.env.QUOTE_FIXTURE_PATH,'utf8'));
 for(const q of quotes)await put({...q,report_date:today});
 const keys=new Set();
 for(const q of quotes){const h=await read(q.row_hash);keys.add(h.series_key);
   assert.equal(h.observations.length,1,'Ambiguous series for '+q.commodity);
   for(const field of ['price_low','price_high','price_mostly_low','price_mostly_high'])assert.equal(h.observations[0][field],q[field]);
 }
 assert.equal(keys.size,quotes.length);
});
console.log(`${checks} PostgreSQL integration checks passed`);await db.close();
