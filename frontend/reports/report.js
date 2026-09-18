(function(){
'use strict';
const categories={fruits:'Fruit',vegetables:'Vegetables',onions_potatoes:'Onions & potatoes',nuts:'Nuts'};
const params=new URLSearchParams(location.search), market=params.get('market'),category=params.get('category');
const status=document.getElementById('status'),report=document.getElementById('report'),print=document.getElementById('print');
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function clean(v){return v==null||/^(n\/?a|none|null|—)?$/i.test(String(v).trim())?'':String(v).trim();}
function text(v){return clean(v)?esc(clean(v)):'—';}
function money(v){return v==null||String(v).trim()===''||!Number.isFinite(Number(v))?null:'$'+Number(v).toFixed(2);}
function range(a,b){const l=money(a),h=money(b);return l&&h?(l===h?l:l+'–'+h):l?l:h?h+' (high only)':'—';}
function unique(values){return values.map(clean).filter((v,i,a)=>v&&a.findIndex(x=>x.toLowerCase()===v.toLowerCase())===i).join('; ');}
const quoteCollator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
function compareQuotes(a,b){
 // Keep comparable quotes adjacent; natural sorting puts 48s before 100s.
 const fields=[r=>clean(r.origin),r=>unique([r.variety,r.properties,r.organic===true?'Organic':null]),r=>clean(r.package),r=>clean(r.size),r=>clean(r.grade),r=>unique([r.quality,r.quality_note,r.appearance,r.condition]),r=>unique([r.notes,r.price_notes,r.price_qualifier])];
 for(let i=0;i<fields.length;i++){
  const left=fields[i](a),right=fields[i](b);
  // Unknown origins follow named origins; unqualified quotes lead their variants.
  const order=i===0&&(!left||!right)?(left?-1:right?1:0):quoteCollator.compare(left,right);
  if(order)return order;
 }
 return 0;
}
function href(key,date){return '/reports/?'+new URLSearchParams({market,category:key,...(date?{date}: {})});}
async function boot(){
 if(!market||!Object.hasOwn(categories,category)){status.textContent='Choose a market and report category from Browse.';return;}
 document.getElementById('back').href='/browse?'+new URLSearchParams({market});
 let date=params.get('date');
 if(date&&!/^\d{4}-\d{2}-\d{2}$/.test(date)){status.textContent='This report date is invalid. Return to Browse to choose a report.';return;}
 try{
  if(!date){const current=await window.agraxAPI.reportCurrent('terminal');date=current.filter(r=>r.market===market&&r.commodity_type===category).map(r=>r.report_date).filter(Boolean).sort().pop();}
  if(!date){status.textContent='No published report is available for this market and category.';return;}
  // Fetch the exact day's complete rows, not the latest-per-SKU composite used by Browse.
  const all=await window.agraxAPI.reportTerminal(date);
  const rows=all.filter(r=>r.market===market&&r.commodity_type===category&&r.report_date===date);
  if(!rows.length){status.textContent='No prices were published for this category on '+date+'. Return to Browse for the latest report.';return;}
  history.replaceState(null,'',href(category,date));
  document.title=market+' · '+categories[category]+' · '+date+' | AgraX report';
  const groups=new Map();rows.forEach(r=>{const key=r.commodity||'Unspecified commodity';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);});
  const codes=unique(rows.map(r=>r.source_report));
  report.innerHTML='<h1>'+esc(market)+' terminal market</h1><div class="eyebrow">'+esc(categories[category])+' · Daily wholesale prices</div><div class="meta"><span>Report date <strong>'+esc(date)+'</strong></span><span>'+groups.size+' commodities</span><span>'+rows.length+' price lines</span><span>Source reports: '+text(codes)+'</span></div><p class="intro">Prices in USD for the package shown. Each row keeps its reported origin, variety, size, grade and qualifiers. “Mostly” is shown only when reported. A dash means the field was not supplied. Prices are not averaged or converted to a different unit.</p><nav class="category-nav" aria-label="Report categories">'+Object.entries(categories).map(([key,label])=>'<a href="'+esc(href(key))+'"'+(key===category?' aria-current="page"':'')+'>'+esc(label)+'</a>').join('')+'</nav>'+[...groups.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([name,items])=>{
   const commentary=unique(items.flatMap(r=>[r.movement,r.supply_note,r.trading_activity]));
   return '<section class="commodity"><div class="table-wrap" tabindex="0" role="region" aria-label="'+esc(name)+' prices; scroll for all columns"><table><caption hidden>'+esc(name)+' — '+esc(market)+' — '+esc(date)+'</caption><colgroup><col style="width:15%"><col style="width:12%"><col style="width:19%"><col style="width:9%"><col style="width:13%"><col style="width:13%"><col style="width:19%"></colgroup><thead><tr><th class="commodity-head" colspan="7"><h2>'+esc(name)+'</h2>'+(commentary?'<p class="tone">'+esc(commentary)+'</p>':'')+'</th></tr><tr class="column-headings">'+['Type / variety','Origin','Package','Size','Grade / quality','Reported price','Condition / notes'].map(n=>'<th scope="col">'+n+'</th>').join('')+'</tr></thead><tbody>'+items.slice().sort(compareQuotes).map(r=>{
   const mostly=range(r.price_mostly_low,r.price_mostly_high);
   return '<tr><td>'+text(unique([r.variety,r.properties,r.organic===true?'Organic':null]))+'</td><td>'+text(r.origin)+'</td><td>'+text(r.package)+'</td><td>'+text(r.size)+'</td><td>'+text(unique([r.grade,r.quality]))+'</td><td class="price">'+(r.price_qualifier?esc(r.price_qualifier)+' ':'')+range(r.price_low,r.price_high)+(mostly==='—'?'':'<span class="mostly">Mostly '+mostly+'</span>')+'</td><td>'+text(unique([r.quality_note,r.appearance,r.condition,r.notes,r.price_notes]))+'</td></tr>';
  }).join('')+'</tbody></table></div></section>';
 }).join('');
 status.hidden=true;report.hidden=false;print.disabled=false;
 }catch(error){status.textContent='The report could not be loaded. Please reload to try again.';}
}
print.addEventListener('click',()=>window.print());boot();
})();
