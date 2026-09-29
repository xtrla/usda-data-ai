(function(){
const Q=window.agraxQuotes, original=window.agraxCommodityDialog.render;
let selectAction=()=>{};
let sidebarObserver;
let tableSearch='', tableCountry='', tableSort=0, tableDescending=false;
const home=location.pathname==='/'||location.pathname==='/index.html';
let category=new URLSearchParams(location.search).get('category')||'', shell, selected='', query='', data=[], currentMarket='', mobileOpen=false;
function show(name,open){shell.querySelector('.lookup-market-summary')?.remove();if(selected && selected!==name){const u=new URL(location.href);['quote_variety','quote_origin','quote_package','quote_size'].forEach(k=>u.searchParams.delete(k));history.replaceState(null,'',u);}selectAction(name);shell.querySelector('.lookup-welcome')?.remove();shell.classList.remove('lookup-welcoming');selected=name;mobileOpen=open;shell.classList.toggle('lookup-detail-open',open);const url=new URL(location.href);url.searchParams.set('c',name);history.replaceState(null,'',url);original(name,data,currentMarket,()=>{mobileOpen=false;selected='';selectAction(null);const u=new URL(location.href);u.searchParams.delete('c');history.replaceState(null,'',u);shell.classList.remove('lookup-detail-open');welcome();shell.querySelector('.lookup-dashboard h2')?.focus();});const panel=document.querySelector('.commodity-dialog');if(panel)shell.querySelector('.lookup-detail').append(panel);if(open)requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}));}


function tableControls(){
 const table=shell.querySelector('.lookup-commodity-table');
 const scoped=data.filter(r=>!category||r.commodity_type===category);
 const countries=[...new Set(scoped.map(r=>window.agraxCountryOf(r.origin)))].sort();
 if(!countries.includes(tableCountry))tableCountry='';
 table.parentElement.insertAdjacentHTML('beforebegin','<div class="lookup-table-controls"><label><span class="commodity-dialog__sr-only">Search commodities in this table</span><input type="search" placeholder="Search commodities…" aria-label="Search commodities in this table"></label><label><span class="commodity-dialog__sr-only">Country of origin</span><select aria-label="Country of origin"><option value="">All countries</option>'+countries.map(c=>'<option value="'+Q.esc(c)+'">'+Q.esc(c)+'</option>').join('')+'</select></label><span role="status" class="lookup-table-count"></span></div>');
 const controls=shell.querySelector('.lookup-table-controls'), input=controls.querySelector('input'), select=controls.querySelector('select');
 input.value=tableSearch;select.value=tableCountry;
 const rows=[...table.tBodies[0].rows];
 const headers=[...table.tHead.rows[0].cells];
 headers.forEach((th,i)=>{const label=th.textContent;th.innerHTML='<button type="button">'+label+' <span aria-hidden="true"></span></button>';th.querySelector('button').onclick=()=>{tableDescending=tableSort===i?!tableDescending:false;tableSort=i;apply();};});
 table.insertAdjacentHTML('afterend','<p class="lookup-table-empty" hidden>No commodities match these filters.</p>');
 function apply(){
 const matchingNames=new Set(scoped.filter(r=>!tableCountry||window.agraxCountryOf(r.origin)===tableCountry).map(r=>r.commodity));
 let count=0;
 rows.forEach(row=>{row.hidden=!(row.cells[0].textContent.toLowerCase().includes(tableSearch.trim().toLowerCase())&&matchingNames.has(row.cells[0].textContent));if(!row.hidden)count++;});
 rows.sort((a,b)=>{const x=a.cells[tableSort].textContent,y=b.cells[tableSort].textContent;const order=tableSort===1?Number(x)-Number(y):x.localeCompare(y,undefined,{numeric:true,sensitivity:'base'});return (tableDescending?-1:1)*order||a.cells[0].textContent.localeCompare(b.cells[0].textContent);}).forEach(row=>table.tBodies[0].append(row));
 headers.forEach((th,i)=>{th.setAttribute('aria-sort',i===tableSort?(tableDescending?'descending':'ascending'):'none');th.querySelector('span').textContent=i===tableSort?(tableDescending?'↓':'↑'):'↕';});
 controls.querySelector('.lookup-table-count').textContent=count+' of '+rows.length+' commodities';
 shell.querySelector('.lookup-table-empty').hidden=count>0;
 }
 input.oninput=()=>{tableSearch=input.value;apply();};select.onchange=()=>{tableCountry=select.value;apply();};apply();
}
function welcome(){
 const detail=shell.querySelector('.lookup-detail');
 detail.querySelector('.lookup-welcome')?.remove();
 const groups=[['','All commodities'],['fruits','Fruit'],['vegetables','Vegetables'],['onions_potatoes','Onions & potatoes'],['nuts','Nuts']];
 const dates=data.map(r=>r.report_date).filter(Boolean).sort();
 const names=[...new Set(data.filter(r=>!category||r.commodity_type===category).map(r=>r.commodity))].filter(Boolean).sort();
 const total=new Set(data.map(r=>r.commodity).filter(Boolean)).size;
 detail.insertAdjacentHTML('beforeend','<div class="lookup-welcome lookup-dashboard"><h2 tabindex="-1">'+Q.esc(currentMarket)+' market overview</h2><p>Latest available USDA terminal market reports. Prices are per reported package.</p><dl class="lookup-summary-stats"><div><dt>Commodities</dt><dd>'+total+'</dd></div><div><dt>Latest report</dt><dd>'+Q.esc(dates.at(-1)||'Not available')+'</dd></div><div><dt>Report coverage</dt><dd>'+groups.slice(1).filter(([key])=>data.some(r=>r.commodity_type===key)).length+' categories</dd></div></dl><p class="lookup-coverage-note">Publication dates can differ by category. Open a commodity for variety, origin, size and package details.</p><nav class="lookup-category-strip" aria-label="Filter commodity table">'+groups.map(([key,label])=>'<button type="button" data-dashboard-category="'+key+'" aria-pressed="'+(key===category)+'"><strong>'+label+'</strong><span>'+new Set(data.filter(r=>!key||r.commodity_type===key).map(r=>r.commodity)).size+' commodities</span></button>').join('')+'</nav><h3>'+(groups.find(([key])=>key===category)?.[1]||'All commodities')+'</h3><div class="lookup-commodity-table-wrap"><table class="lookup-commodity-table"><thead><tr><th>Commodity</th><th>Varieties</th><th>Origins</th><th>Latest report</th></tr></thead><tbody>'+names.map(n=>{const rows=data.filter(r=>r.commodity===n);return '<tr><th scope="row"><button type="button" data-open-product="'+Q.esc(n)+'">'+Q.esc(n)+'</button></th><td>'+new Set(rows.map(r=>r.variety).filter(Boolean)).size+'</td><td>'+Q.esc([...new Set(rows.map(r=>r.origin).filter(Boolean))].join(', ')||'Not reported')+'</td><td>'+Q.esc(rows.map(r=>r.report_date).filter(Boolean).sort().pop()||'Not reported')+'</td></tr>';}).join('')+'</tbody></table>'+(names.length?'':'<p>No commodities available in this category.</p>')+'</div></div>');
 const reportCards=groups.slice(1).map(([key,label])=>{
 const date=data.filter(r=>r.commodity_type===key).map(r=>r.report_date).filter(Boolean).sort().pop();
 return date?'<a href="'+Q.esc('/reports/?'+new URLSearchParams({market:currentMarket,category:key,date}))+'" title="'+Q.esc(label+' report · '+date+' · Open to print or save PDF')+'">'+label+' <span aria-hidden="true">&darr;</span><span class="commodity-dialog__sr-only"> report, '+date+'; open to print or save PDF</span></a>':'<span class="lookup-report-missing" title="No report available">'+label+' — unavailable</span>';
 }).join('');
 const stats=detail.querySelector('.lookup-summary-stats');
 const summary=document.createElement('div');summary.className='lookup-summary-block';stats.before(summary);summary.append(stats);
 summary.insertAdjacentHTML('beforeend','<nav class="lookup-report-links" aria-label="Download market reports"><span>Reports & PDFs</span>'+reportCards+'</nav>');
 tableControls();
 shell.classList.add('lookup-welcoming');
 detail.querySelectorAll('[data-dashboard-category]').forEach(b=>b.onclick=()=>{
 selected='';selectAction(null);original(null,data,currentMarket,()=>{});category=b.dataset.dashboardCategory;
 const url=new URL(location.href);if(category)url.searchParams.set('category',category);else url.searchParams.delete('category');history.replaceState(null,'',url);
 welcome();
 });
 detail.querySelectorAll('[data-open-product]').forEach(b=>b.onclick=()=>show(b.dataset.openProduct,true));
 detail.querySelectorAll('.lookup-commodity-table tbody tr').forEach(row=>row.onclick=e=>{if(!e.target.closest('button')&&!window.getSelection().toString())row.querySelector('button').click();});
 sidebar();
}

function marketContext(){
 const groups=[['fruits','Fruit'],['vegetables','Vegetables'],['onions_potatoes','Onions & potatoes'],['nuts','Nuts']];
 const reports=groups.map(([key,label])=>({key,label,date:data.filter(r=>r.commodity_type===key).map(r=>r.report_date).filter(Boolean).sort().pop()})).filter(r=>r.date);
 let panel=shell.querySelector('.lookup-market-summary');
 if(!panel){panel=document.createElement('section');panel.className='lookup-market-summary';panel.setAttribute('aria-label','Market reports and overview');shell.querySelector('.lookup-detail').append(panel);}
 const opened=panel.querySelector('#lookup-reports')?.open, overview=panel.querySelector('#lookup-overview')?.open;
 panel.innerHTML='<div class="lookup-market-heading"><strong>'+Q.esc(currentMarket)+' terminal market</strong><span>'+(reports.length?'Latest report: '+Q.esc(reports.map(r=>r.date).sort().pop()):'No published reports available')+'</span></div><div class="lookup-market-actions"><details id="lookup-reports"'+(opened?' open':'')+'><summary>View reports</summary><div class="lookup-report-panel"><p>Open a report to print or save it as a PDF.</p><div class="lookup-report-grid">'+(reports.map(r=>'<a href="'+Q.esc('/reports/?'+new URLSearchParams({market:currentMarket,category:r.key,date:r.date}))+'"><strong>'+r.label+'</strong><time datetime="'+Q.esc(r.date)+'">'+Q.esc(r.date)+'</time><span>View report &rarr;</span></a>').join('')||'<p>No published reports available.</p>')+'</div></div></details><details id="lookup-overview"'+(overview?' open':'')+'><summary>Market overview</summary><div class="lookup-overview-panel"><p>Wholesale prices reported by USDA AMS for '+Q.esc(currentMarket)+'. Prices apply to the package, size, origin and grade shown with each quote.</p><p>Categories may have different publication dates. These are the latest available reports, not live transaction prices.</p><dl>'+reports.map(r=>'<div><dt>'+r.label+'</dt><dd>'+Q.esc(r.date)+'</dd></div>').join('')+'</dl></div></details></div>';
}


function overview(){
 selected='';selectAction(null);original(null,data,currentMarket,()=>{});
 const url=new URL(location.href);url.searchParams.delete('c');history.replaceState(null,'',url);
 shell.querySelector('.lookup-welcome')?.remove();
 shell.classList.remove('lookup-welcoming');shell.classList.add('lookup-detail-open');
 marketContext();shell.querySelector('#lookup-overview').open=true;shell.querySelector('#lookup-reports').open=true;
}

function sidebar(){
 const aside=shell.querySelector('.lookup-products');
 const categoryNav=shell.querySelector('.lookup-detail .lookup-category-strip')||aside.querySelector('.lookup-category-strip');
 const cities=[...document.querySelectorAll('[data-market-city]')];
 aside.innerHTML='<div class="lookup-sidebar-nav"><h2>Terminal markets</h2><nav aria-label="Terminal cities">'+cities.map((b,i)=>{const n=[...b.children].filter(s=>s.tagName==='SPAN'&&s.textContent.trim())[0]?.textContent.trim();return '<button type="button" data-city="'+i+'" aria-pressed="'+(n===currentMarket)+'">'+Q.esc(n||currentMarket)+'</button>';}).join('')+'</nav></div>';
 aside.querySelectorAll('[data-city]').forEach(b=>b.onclick=()=>{selected='';category='';selectAction(null);cities[Number(b.dataset.city)].click();});
 if(categoryNav){
 const section=document.createElement('section');section.className='lookup-sidebar-categories';section.innerHTML='<h2>Categories</h2>';section.append(categoryNav);aside.append(section);
 }
 const align=()=>{
 const heading=shell.querySelector('.lookup-dashboard>h3');
 if(!heading||!window.matchMedia('(min-width:900px)').matches){aside.style.removeProperty('--market-nav-height');return;}
 const top=aside.getBoundingClientRect().top;
 aside.style.setProperty('--market-nav-height',Math.max(150,heading.getBoundingClientRect().top-top-31)+'px');
 };
 sidebarObserver?.disconnect();sidebarObserver=new ResizeObserver(align);
 sidebarObserver.observe(shell.querySelector('.lookup-detail'));requestAnimationFrame(align);
}

function updateNavigation(){}
window.agraxCommodityDialog.render=function(name,rows,market,onClose,onSelect){
 selectAction=onSelect||(()=>{});
 if(currentMarket && currentMarket!==market){tableSearch='';tableCountry='';shell?.querySelector('.lookup-market-summary')?.remove();shell?.querySelector('.lookup-welcome')?.remove();}
 data=rows;currentMarket=market;
 if(!shell){shell=document.createElement('main');shell.className='lookup-workspace';shell.innerHTML='<div class="lookup-context"><div><span class="lookup-eyebrow">WHOLESALE PRODUCE PRICES</span><label>Market <select aria-label="Terminal market"></select></label></div><span class="lookup-source">USDA AMS · Prices per reported package</span></div><div class="lookup-layout"><aside class="lookup-products"></aside><section class="lookup-detail" aria-label="Selected commodity prices"></section></div><footer>AgraX · Source: USDA AMS Market News. Independent presentation of reported prices. <a href="/about/">About the data</a></footer>';document.querySelector('#page-root').after(shell);if(home){shell.insertAdjacentHTML('afterbegin','<section class="lookup-intro"><h1>Find your product. Know your market.</h1><p>Wholesale produce prices from USDA reports, organized around the way you buy.</p></section>');shell.querySelector('footer').insertAdjacentHTML('beforebegin','<section class="lookup-benefits"><div><h3>The full quote, in view.</h3><p>Variety, origin, pack and size beside the reported price.</p></div><div><h3>Compare like for like.</h3><p>Select a quote to explore other markets and price history.</p></div><div><h3>Know the source.</h3><p>Check publication dates and open the original USDA report.</p></div></section>');}}
 shell.hidden=false;document.body.classList.add('lookup-ready');
 if(!shell.querySelector('.browse-intro'))shell.insertAdjacentHTML('afterbegin','<section class="browse-intro"><p class="refresh-eyebrow">THE MARKET WORKSPACE</p><h1>Browse produce prices.</h1><p>Choose a market, find your commodity, and explore the details behind each quote.</p></section>');
 const markets=[...document.querySelectorAll('[data-market-city]')];
 const control=shell.querySelector('select');control.innerHTML=markets.map((b,i)=>{const spans=[...b.children].filter(s=>s.tagName==='SPAN'&&s.textContent.trim());const n=spans[0]?.textContent.trim();return '<option value="'+i+'" '+(n===market?'selected':'')+'>'+Q.esc(n||market)+'</option>';}).join('');
 control.onchange=()=>{selected='';category='';markets[Number(control.value)].click();};
 const chosen=name||selected;
 if(chosen && data.some(r=>r.commodity===chosen))show(chosen,!!name||mobileOpen);else{original(null,data,currentMarket,()=>{});welcome();}sidebar();updateNavigation();
};
})();
