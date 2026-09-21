(function () {
  'use strict';
  const Q = window.agraxQuotes;
  let dialog, signature = '', closeAction, selected = '', rows = [], market = '', visibleRows = [];
  function drawTable() {
    const variety = dialog.querySelector('[name=variety]').value;
    const origin = dialog.querySelector('[name=origin]').value;
    const matches = rows.filter(r => (!variety || Q.unique([r.variety,r.properties,r.organic===true?'Organic':null]) === variety) && (!origin || Q.clean(r.origin) === origin));
    visibleRows = matches;
    if(rows.length) {
      const url=new URL(location.href);
      for(const [key,value] of [['quote_variety',variety],['quote_origin',origin]]) {
        if(value)url.searchParams.set(key,value);else url.searchParams.delete(key);
      }
      history.replaceState(null,'',url);
    }
    dialog.querySelector('[data-export=print]').disabled = !matches.length;
    dialog.querySelector('.commodity-dialog__count').textContent = matches.length + ' of ' + rows.length + ' prices';
    dialog.querySelector('.commodity-dialog__table').innerHTML = matches.length ? Q.table(selected, matches, market, '') : '<p class="commodity-empty">No prices match these filters.</p>';
    if (matches.length) window.agraxQuoteHistory.attach(dialog.querySelector('.commodity-dialog__table'), matches, market);
  }
  async function share() {
    const url = new URL('/browse/',location.origin);
    url.searchParams.set('market',market);
    url.searchParams.set('c',selected);
    for (const key of ['variety','origin']) {
      const value=dialog.querySelector('[name='+key+']').value;
      if(value)url.searchParams.set('quote_'+key,value);
    }
    if(new URLSearchParams(location.search).get('older')==='1')url.searchParams.set('older','1');
    const status=dialog.querySelector('.commodity-share-status');
    try {
      if(navigator.share)await navigator.share({title:selected+' · '+market+' | AgraX',url:url.href});
      else {await navigator.clipboard.writeText(url.href);status.textContent='Link copied. Opens current prices with these filters.';}
    } catch(error) {
      if(error.name==='AbortError')return;
      status.replaceChildren(document.createTextNode('Copy this link: '));
      const field=document.createElement('input');field.readOnly=true;field.value=url.href;field.setAttribute('aria-label','Share commodity link');status.append(field);field.select();
    }
  }
  function printQuotes() {
    if(!visibleRows.length)return;
    document.getElementById('commodity-print-frame')?.remove();
    const frame=document.createElement('iframe');frame.id='commodity-print-frame';frame.title='Printable commodity report';
    frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
    frame.style.cssText='position:fixed;width:1px;height:1px;bottom:0;left:0;border:0;opacity:0;pointer-events:none';
    const dates=[...new Set(visibleRows.map(r=>r.report_date||r.market_date).filter(Boolean))].sort().join(' · ');
    const filters=['variety','origin'].map(key=>dialog.querySelector('[name='+key+']').value).filter(Boolean).join(' · ');
    frame.srcdoc='<!doctype html><html><head><meta charset="utf-8"><title>'+Q.esc(selected+' — '+market+' — '+dates)+'</title><link rel="stylesheet" href="'+location.origin+'/reports/report.css"></head><body><main><h1>AgraX · '+Q.esc(selected)+'</h1><p>'+Q.esc(market)+' terminal · '+Q.esc(dates)+'</p><p>'+visibleRows.length+' reported prices'+(filters?' · Filters: '+Q.esc(filters):'')+'</p><p class="intro">Prices in USD for the package shown. “Mostly” is included only when reported. A dash means the field was not supplied.</p>'+Q.table(selected,visibleRows,market,dates)+'<footer>AgraX · Source: USDA Agricultural Marketing Service, Market News.<br>Independent presentation of USDA data. AgraX is not affiliated with USDA.</footer></main></body></html>';
    frame.addEventListener('load',()=>{frame.contentWindow.focus();frame.contentWindow.print();},{once:true});
    document.body.append(frame);
  }
  function select(name, label, values) {
    const options = [...new Set(values.filter(Boolean))].sort(new Intl.Collator('en',{numeric:true}).compare);
    return '<label>'+label+'<select name="'+name+'"><option value="">All '+label.toLowerCase()+'</option>'+options.map(v=>'<option value="'+Q.esc(v)+'">'+Q.esc(v)+'</option>').join('')+'</select></label>';
  }
  function render(name, all, currentMarket, onClose) {
    closeAction = onClose;
    if (!name) { if (dialog && dialog.open) dialog.close(); signature = ''; return; }
    rows = all.filter(r=>r.commodity===name);
    const next = JSON.stringify([name,currentMarket,rows]);
    if (next === signature && dialog && dialog.open) return;
    signature = next; selected = name; market = currentMarket;
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'commodity-dialog';
      dialog.setAttribute('aria-labelledby','commodity-dialog-title');
      document.body.append(dialog);
      dialog.addEventListener('close',()=>{
        signature = ''; document.body.classList.remove('commodity-dialog-open');
        if (closeAction) closeAction();
        const trigger = [...document.querySelectorAll('.commodity-open')].find(el=>el.textContent===selected && el.getClientRects().length);
        if (trigger) trigger.focus({preventScroll:true});
      });
      dialog.addEventListener('click',e=>{if(e.target===dialog){const b=dialog.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)dialog.close();}});
    }
    const dates = [...new Set(rows.map(r=>r.report_date||r.market_date).filter(Boolean))].sort();
    const origins = [...new Set(rows.map(r=>Q.clean(r.origin)).filter(Boolean))];
    const varieties = [...new Set(rows.map(r=>Q.unique([r.variety,r.properties,r.organic===true?'Organic':null])).filter(Boolean))];
    const reportHref='/reports/?'+new URLSearchParams({market,category:rows[0]?.commodity_type||'fruits',...(dates.length?{date:dates[dates.length-1]}:{})});
    dialog.innerHTML='<header class="commodity-dialog__header"><div><p class="commodity-dialog__eyebrow">'+Q.esc(market)+' terminal · '+Q.esc(dates.length===1?dates[0]:dates.length?dates[0]+' – '+dates[dates.length-1]:'Loading report')+'</p><h1><span id="commodity-dialog-title">'+Q.esc(name)+'</span><span data-watch-commodity="'+Q.esc(name)+'"></span></h1></div><button class="commodity-dialog__close" aria-label="Close commodity details" autofocus>×</button></header><div class="commodity-dialog__body"><div class="commodity-dialog__overview"><span><strong>'+rows.length+'</strong> reported prices</span><span><strong>'+varieties.length+'</strong> varieties</span><span><strong>'+origins.length+'</strong> origins</span><a href="'+Q.esc(reportHref)+'">Full report / PDF ↗</a></div><p class="commodity-dialog__note">Prices in USD for the package shown. “Mostly” is included only when reported. Each quote preserves its variety, origin, package, size, grade, and notes.</p><div class="commodity-dialog__actions"><button data-export="share">Share</button><button data-export="print">Print / Save PDF</button></div><p class="commodity-share-status" role="status"></p><div class="commodity-dialog__filters">'+select('variety','Varieties',varieties)+select('origin','Origins',origins)+'<span class="commodity-dialog__count" role="status"></span></div><div class="commodity-dialog__table"></div></div>';
    dialog.querySelector('.commodity-dialog__close').addEventListener('click',()=>dialog.close());
    dialog.querySelectorAll('select').forEach(el=>el.addEventListener('change',drawTable));
    const shared = new URLSearchParams(location.search);
    for (const key of ['variety','origin']) {
      const control = dialog.querySelector('[name='+key+']');
      const value = shared.get('quote_'+key);
      if ([...control.options].some(o=>o.value===value)) control.value=value;
    }
    dialog.querySelector('[data-export=share]').addEventListener('click',share);
    dialog.querySelector('[data-export=print]').addEventListener('click',printQuotes);
    drawTable();
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('commodity-dialog-open');
    if (window.agraxAccountUI) window.agraxAccountUI.mount();
  }
  window.agraxCommodityDialog={render};
})();
