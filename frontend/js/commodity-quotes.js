(function(root){
'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function clean(v){return v==null||/^(n\/?a|none|null|—)?$/i.test(String(v).trim())?'':String(v).trim();}
function text(v){return clean(v)?esc(clean(v)):'—';}
function money(v){return v==null||String(v).trim()===''||!Number.isFinite(Number(v))?null:'$'+Number(v).toFixed(2);}
function range(a,b){const l=money(a),h=money(b);return l&&h?(l===h?l:l+'–'+h):l?l:h?h+' (high only)':'—';}
function unique(values){return values.map(clean).filter((v,i,a)=>v&&a.findIndex(x=>x.toLowerCase()===v.toLowerCase())===i).join('; ');}
const quoteCollator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
function compareSizes(a,b){
 const ranks={xs:0,xsml:0,'extra small':0,sml:1,small:1,med:2,medium:2,lge:3,large:3,xlge:4,'extra large':4,jbo:5,jumbo:5,col:6,colossal:6};
 const left=ranks[a.toLowerCase()],right=ranks[b.toLowerCase()];
 if(left!==undefined&&right!==undefined)return left-right;
 // Compare mixed fractions as measurements, not their denominator text.
 const measure=v=>v.match(/^(\d+)\s+(\d+)\/(\d+)(.*)$/);
 const x=measure(a),y=measure(b);
 if(x&&y&&x[4]===y[4])return (+x[1]+x[2]/x[3])-(+y[1]+y[2]/y[3]);
 return quoteCollator.compare(a,b);
}
function compareQuotes(a,b){
 // Keep comparable quotes adjacent; natural sorting puts 48s before 100s.
 const fields=[r=>unique([r.variety,r.properties,r.organic===true?'Organic':null]),r=>clean(r.origin),r=>clean(r.package),r=>clean(r.size),r=>clean(r.grade),r=>unique([r.quality,r.quality_note,r.appearance,r.condition]),r=>unique([r.notes,r.price_notes,r.price_qualifier])];
 for(let i=0;i<fields.length;i++){
  const left=fields[i](a),right=fields[i](b);
  // Unknown origins follow named origins; unqualified quotes lead their variants.
  const order=i===1&&(!left||!right)?(left?-1:right?1:0):(i===3?compareSizes(left,right):quoteCollator.compare(left,right));
  if(order)return order;
 }
 return 0;
}

function table(name,items,market,date){
const mixedDates=new Set(items.map(r=>r.report_date||r.market_date).filter(Boolean)).size>1;
const commentary=unique(items.flatMap(r=>[r.movement,r.supply_note,r.trading_activity]));
return '<section class="commodity"><div class="table-wrap" tabindex="0" role="region" aria-label="'+esc(name)+' prices; scroll for all columns"><table><caption hidden>'+esc(name)+' — '+esc(market)+' — '+esc(date)+'</caption><colgroup><col style="width:15%"><col style="width:12%"><col style="width:19%"><col style="width:9%"><col style="width:13%"><col style="width:13%"><col style="width:19%"></colgroup><thead><tr><th class="commodity-head" colspan="7"><h2>'+esc(name)+'</h2>'+(commentary?'<p class="tone">'+esc(commentary)+'</p>':'')+'</th></tr><tr class="column-headings">'+['Type / variety','Origin','Package','Size','Grade / quality','Reported price','Condition / notes'].map(n=>'<th scope="col">'+n+'</th>').join('')+'</tr></thead><tbody>'+items.slice().sort(compareQuotes).map(r=>{
   const mostly=range(r.price_mostly_low,r.price_mostly_high);
   return '<tr><td data-label="Type / variety">'+text(unique([r.variety,r.properties,r.organic===true?'Organic':null]))+'</td><td data-label="Origin">'+text(r.origin)+'</td><td data-label="Package">'+text(r.package)+'</td><td data-label="Size">'+text(r.size)+'</td><td data-label="Grade / quality">'+text(unique([r.grade,r.quality]))+'</td><td class="price" data-label="Reported price">'+(r.price_qualifier?esc(r.price_qualifier)+' ':'')+range(r.price_low,r.price_high)+(mostly==='—'?'':'<span class="mostly">Mostly '+mostly+'</span>')+'</td><td data-label="Condition / notes">'+text(unique([r.quality_note,r.appearance,r.condition,r.notes,r.price_notes,mixedDates?'Report date: '+(r.report_date||r.market_date||'Not supplied'):null]))+'</td></tr>';
  }).join('')+'</tbody></table></div></section>';
}
root.agraxQuotes={esc,clean,unique,compareQuotes,table};
})(typeof window !== 'undefined' ? window : globalThis);
