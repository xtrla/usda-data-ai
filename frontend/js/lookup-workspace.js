(function(){
const Q=window.agraxQuotes, original=window.agraxCommodityDialog.render;
let selectAction=()=>{};
const home=location.pathname==='/'||location.pathname==='/index.html';
let category='', shell, selected='', query='', data=[], currentMarket='', mobileOpen=false;
function list(){
 const names=[...new Set(data.filter(r=>!category||r.commodity_type===category).map(r=>r.commodity))].filter(Boolean).sort();
 const matches=names.filter(n=>n.toLowerCase().includes(query.toLowerCase()));
 shell.querySelector('.lookup-count').textContent=matches.length+' commodities';
 shell.querySelector('.lookup-list').innerHTML=matches.map(n=>'<button type="button" data-product="'+Q.esc(n)+'" aria-pressed="'+(n===selected)+'"><strong>'+Q.esc(n)+'</strong><span>'+data.filter(r=>r.commodity===n).length+' quotes</span></button>').join('')||'<p>No commodities match your search.</p>';
 shell.querySelectorAll('[data-product]').forEach(b=>b.onclick=()=>show(b.dataset.product,true));
}
function show(name,open){if(selected && selected!==name){const u=new URL(location.href);['quote_variety','quote_origin','quote_package','quote_size'].forEach(k=>u.searchParams.delete(k));history.replaceState(null,'',u);}selectAction(name);shell.querySelector('.lookup-welcome')?.remove();shell.classList.remove('lookup-welcoming');selected=name;mobileOpen=open;shell.classList.toggle('lookup-detail-open',open);list();const url=new URL(location.href);url.searchParams.set('c',name);history.replaceState(null,'',url);original(name,data,currentMarket,()=>{mobileOpen=false;selected='';selectAction(null);const u=new URL(location.href);u.searchParams.delete('c');history.replaceState(null,'',u);shell.classList.remove('lookup-detail-open');welcome();list();shell.querySelector('.lookup-search').focus();});const panel=document.querySelector('.commodity-dialog');if(panel)shell.querySelector('.lookup-detail').append(panel);if(open)requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}));}
function welcome(){
 const detail=shell.querySelector('.lookup-detail');
 if(detail.querySelector('.lookup-welcome'))return;
 detail.insertAdjacentHTML('beforeend','<div class="lookup-welcome"><h2>What do you work with?</h2><p>Search a commodity, or start with a category.</p><div class="lookup-categories">'+[['fruits','Fruit','Apples, avocados, berries'],['vegetables','Vegetables','Greens, tomatoes, broccoli'],['onions_potatoes','Onions & potatoes','Everyday staples, by pack'],['nuts','Nuts','Explore reported varieties']].map(c=>'<button type="button" data-category="'+c[0]+'"><strong>'+c[1]+'</strong><span>'+c[2]+'</span></button>').join('')+'</div><p class="lookup-help">No account needed to look up prices. Choose a product to see its varieties and reported packages.</p></div>');
 shell.classList.add('lookup-welcoming');
 detail.querySelectorAll('[data-category]').forEach(b=>b.onclick=()=>{category=b.dataset.category;query='';shell.querySelector('.lookup-search').value='';list();shell.querySelector('.lookup-count').innerHTML+=' <button type="button" class="lookup-clear">Show all</button>';shell.querySelector('.lookup-clear').onclick=()=>{category='';list();};shell.querySelector('.lookup-products').scrollIntoView({block:'start',behavior:'smooth'});});
}
function updateNavigation(){
 const nav=document.querySelector('.agrax-navigation');if(!nav)return;
 if(!nav.querySelector('[data-tool-nav]')){nav.querySelectorAll(':scope > a').forEach(a=>a.remove());const wrap=document.createElement('div');wrap.className='lookup-nav';wrap.dataset.toolNav='';wrap.innerHTML='<a href="/" aria-current="page">Prices</a><a data-reports href="/reports/">Reports</a><button type="button" data-saved>Saved</button><a href="/about">About</a>';nav.prepend(wrap);wrap.querySelector('[data-saved]').onclick=()=>window.agraxAccountUI?.open('watchlist');}
 nav.querySelector('[data-reports]').href='/reports/?'+new URLSearchParams({market:currentMarket,category:'fruits'});
}
window.agraxCommodityDialog.render=function(name,rows,market,onClose,onSelect){
 selectAction=onSelect||(()=>{});
 data=rows;currentMarket=market;
 if(!shell){shell=document.createElement('main');shell.className='lookup-workspace';shell.innerHTML='<div class="lookup-context"><div><span class="lookup-eyebrow">WHOLESALE PRODUCE PRICES</span><label>Market <select aria-label="Terminal market"></select></label></div><span class="lookup-source">USDA AMS · Prices per reported package</span></div><div class="lookup-layout"><aside class="lookup-products"><label for="lookup-search">Find your product</label><input id="lookup-search" class="lookup-search" type="search" placeholder="Search commodities"><p class="lookup-count"></p><nav class="lookup-list" aria-label="Commodities"></nav></aside><section class="lookup-detail" aria-label="Selected commodity prices"></section></div><footer>AgraX · Source: USDA AMS Market News. Independent presentation of reported prices. <a href="/about/">About the data</a></footer>';document.querySelector('#page-root').after(shell);if(home){shell.insertAdjacentHTML('afterbegin','<section class="lookup-intro"><h1>Find your product. Know your market.</h1><p>Wholesale produce prices from USDA reports, organized around the way you buy.</p></section>');shell.querySelector('footer').insertAdjacentHTML('beforebegin','<section class="lookup-benefits"><div><h3>The full quote, in view.</h3><p>Variety, origin, pack and size beside the reported price.</p></div><div><h3>Compare like for like.</h3><p>Select a quote to explore other markets and price history.</p></div><div><h3>Know the source.</h3><p>Check publication dates and open the original USDA report.</p></div></section>');}shell.querySelector('input').oninput=e=>{query=e.target.value;list();};}
 shell.hidden=false;document.body.classList.add('lookup-ready');
 const markets=[...document.querySelectorAll('[data-market-city]')];
 const control=shell.querySelector('select');control.innerHTML=markets.map((b,i)=>{const spans=[...b.children].filter(s=>s.tagName==='SPAN'&&s.textContent.trim());const n=spans[0]?.textContent.trim();return '<option value="'+i+'" '+(n===market?'selected':'')+'>'+Q.esc(n||market)+'</option>';}).join('');
 control.onchange=()=>{selected='';category='';markets[Number(control.value)].click();};
 const chosen=name||selected|| (!home && (data.some(r=>r.commodity==='Potatoes')?'Potatoes':data[0]?.commodity));
 if(chosen && data.some(r=>r.commodity===chosen))show(chosen,!!name||mobileOpen);else{original(null,data,currentMarket,()=>{});welcome();list();}updateNavigation();
};
})();
