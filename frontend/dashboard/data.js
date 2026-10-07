(function(root){
'use strict';
const fields=['market_type','commodity_type','commodity','variety','origin','package','size','grade','quality','quality_note','properties','appearance','condition','notes','price_notes','price_qualifier','organic','unit','price_unit'];
const norm=v=>v==null?'':String(v).trim().replace(/\s+/g,' ').toLowerCase();
const number=v=>v==null||String(v).trim()===''||!Number.isFinite(+v)?null:+v;
const valid=r=>r&&r.market_type==='terminal'&&r.market&&r.commodity&&/^\d{4}-\d{2}-\d{2}$/.test(r.report_date||'');
function latest(rows){const dates=new Map();rows.filter(valid).forEach(r=>{const k=JSON.stringify([r.market,r.source_report,r.commodity_type]);dates.set(k,[dates.get(k)||'',r.report_date].sort().at(-1));});return rows.filter(r=>valid(r)&&r.report_date===dates.get(JSON.stringify([r.market,r.source_report,r.commodity_type])));}
function midpoint(r){const a=number(r.price_low),b=number(r.price_high);return a!==null&&b!==null&&a>=0&&b>=a?(a+b)/2:null;}
function matches(rows,q){if(!q||!norm(q.variety)||!norm(q.origin)||!norm(q.package))return [];return latest(rows).filter(r=>r.market!==q.market&&r.report_date===q.report_date&&fields.every(k=>norm(r[k])===norm(q[k])));}
function series(payload,q){if(!payload||!payload.found||!payload.series_key||!Array.isArray(payload.observations))throw Error('History unavailable');const byDate=new Map();for(const r of payload.observations){if(!valid(r)||r.market!==q.market||r.report_date>q.report_date||fields.some(k=>norm(r[k])!==norm(q[k]))||midpoint(r)===null)continue;const old=byDate.get(r.report_date);if(!old||Number(r.history_revision||0)>=Number(old.history_revision||0))byDate.set(r.report_date,r);}return [...byDate.values()].sort((a,b)=>a.report_date.localeCompare(b.report_date));}
root.agraxDashboardData={latest,midpoint,matches,series,number};
})(typeof window!=='undefined'?window:globalThis);
