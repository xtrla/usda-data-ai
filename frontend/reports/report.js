(function(){
'use strict';
const categories={fruits:'Fruit',vegetables:'Vegetables',onions_potatoes:'Onions & potatoes',nuts:'Nuts'};
const params=new URLSearchParams(location.search), market=params.get('market'),category=params.get('category');
const status=document.getElementById('status'),report=document.getElementById('report'),print=document.getElementById('print');
const {esc,clean,unique}=window.agraxQuotes;
function text(v){return clean(v)?esc(clean(v)):'—';}
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
   return window.agraxQuotes.table(name,items,market,date);
 }).join('');
 status.hidden=true;report.hidden=false;print.disabled=false;
 }catch(error){status.textContent='The report could not be loaded. Please reload to try again.';}
}
print.addEventListener('click',()=>window.print());boot();
})();
