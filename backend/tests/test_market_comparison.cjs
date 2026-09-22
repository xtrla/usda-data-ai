const assert = require('node:assert/strict');
require('../../frontend/js/quote-history.js');
const {marketMatches} = globalThis.agraxQuoteHistory;
const quote = {market:'New York',commodity:'Apples',commodity_type:'fruits',market_type:'terminal',variety:'FUJI',origin:'Washington',package:'cartons tray pack',size:'80s',grade:'WA Extra Fancy',report_date:'2026-09-21',source_report:'NX_FV010',organic:false};
const match = {...quote,market:'Baltimore',source_report:'BP_FV010',report_date:'2026-09-18',price_low:40};
assert.deepEqual(marketMatches([match],quote),[match]);
for(const field of ['variety','origin','package','size','grade','condition','notes','organic','price_unit']) {
  assert.equal(marketMatches([{...match,[field]:'different'}],quote).length,0,field);
}
assert.equal(marketMatches([quote,{...match,is_current:false}],quote).length,0);
assert.equal(marketMatches([match],{...quote,variety:''}).length,0);
assert.equal(marketMatches([{...match,variety:' fuji '}],quote).length,1);
console.log('Market comparison checks passed');
