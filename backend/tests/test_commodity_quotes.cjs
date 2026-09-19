const test = require('node:test');
const assert = require('node:assert/strict');
require('../../frontend/js/commodity-quotes.js');
const Q=globalThis.agraxQuotes;
test('quotes group variety, origin and package before natural size',()=>{
 const rows=[{variety:'HASS',origin:'Mexico',package:'cartons',size:'100s'},{variety:'GREENSKIN',origin:'Florida',size:'18s'},{variety:'HASS',origin:'Mexico',package:'cartons',size:'48s'},{variety:'HASS',origin:'Chile',package:'cartons',size:'60s'}];
 assert.deepEqual(rows.sort(Q.compareQuotes).map(r=>r.origin+' '+r.size),['Florida 18s','Chile 60s','Mexico 48s','Mexico 100s']);
});
test('shared table preserves qualifiers, mostly prices and safely escapes notes',()=>{
 const html=Q.table('Avocados',[{variety:'HASS',price_low:32,price_high:36,price_mostly_low:34,price_mostly_high:35,grade:'US No. 1',quality_note:'Fine',condition:'Firm',notes:'<script>bad</script>'}], 'New York','2026-09-18');
 for(const value of ['Grade / quality','Condition / notes','$32.00–$36.00','Mostly $34.00–$35.00','US No. 1','Fine; Firm; &lt;script&gt;bad&lt;/script&gt;'])assert.ok(html.includes(value));
 assert.ok(!html.includes('<script>'));
});
test('named sizes and fractional measurements sort by size',()=>{
 const sort=sizes=>sizes.map(size=>({size})).sort(Q.compareQuotes).map(r=>r.size);
 assert.deepEqual(sort(['xlge','med','sml','lge']),['sml','med','lge','xlge']);
 assert.deepEqual(sort(['2 1/2 inch','2 1/4 inch','2 3/4 inch']),['2 1/4 inch','2 1/2 inch','2 3/4 inch']);
});
