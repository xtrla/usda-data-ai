const test=require('node:test'),assert=require('node:assert/strict');
require('../../frontend/js/quote-history.js');
const H=globalThis.agraxQuoteHistory;
const quote={commodity:'Avocados',market:'New York',variety:'HASS',origin:'Mexico',size:'48s',package:'cartons',grade:'Class I'};
test('history excludes different origins, sizes and quality qualifiers',()=>{
 const rows=[{...quote},{...quote,size:'60s'},{...quote,quality_note:'Fine appearance'},{...quote,organic:true},{...quote,origin:'Chile'},{...quote,grade:null}];
 assert.equal(rows.filter(r=>H.sameQuote(r,quote)).length,1);
});
test('observations preserve ranges and distinct same-day quotes without averaging',()=>{
 const row={...quote,report_date:'2026-09-18',price_low:32,price_high:36,price_mostly_low:34,price_mostly_high:35};
 const points=H.observations([row,row,{...row,price_high:38},{...row,report_date:'2026-09-17',price_low:0,price_high:0}],quote);
 assert.equal(points.length,3);assert.equal(points[0].low,0);assert.equal(points[1].mostlyHigh,35);assert.equal(points[2].high,38);
});
test('missing and invalid prices never become zero',()=>{
 const rows=[{...quote,report_date:'2026-09-18',price_low:'',price_high:null},{...quote,report_date:'bad',price_low:32},{...quote,report_date:'2026-09-18',price_low:40,price_high:30},{...quote,report_date:'2026-09-18',price_low:null,price_high:36}];
 const points=H.observations(rows,quote);assert.equal(points.length,1);assert.equal(points[0].low,null);assert.equal(points[0].high,36);
});
test('invalid calendar dates, negative prices and reversed mostly are excluded',()=>{
 const base={...quote,report_date:'2026-09-20',price_low:32,price_high:36};
 const rows=[{...base,report_date:'2026-02-30'},{...base,price_low:-1},{...base,price_mostly_low:35,price_mostly_high:33},base];
 assert.equal(H.observations(rows,quote).length,1);
});
test('server-verified identity allows qualified note prices to change over time',()=>{
 const base={...quote,report_date:'2026-09-20',price_low:32,price_high:36,notes:'few 32.00-36.00'};
 assert.equal(H.observations([base],{...quote,notes:'few 34.00-38.00'},true).length,1);
});

test('reporting day uses New York rather than changing at UTC midnight',()=>{
 assert.equal(H.reportingDay(new Date('2026-09-21T01:00:00Z')),'2026-09-20');
 assert.equal(H.reportingDay(new Date('2026-09-21T05:00:00Z')),'2026-09-21');
});
