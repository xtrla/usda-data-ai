window.agraxReferenceDetail=function(dialog,rows,name,market){
 dialog.querySelector('.reference-quote-overview')?.remove();if(!rows.length)return;
 const Q=window.agraxQuotes;const ordered=rows.slice().sort(Q.compareQuotes);const panel=document.createElement('section');panel.className='reference-quote-overview';panel.innerHTML='<label class="reference-spec-label">Selected specification<select aria-label="Specification for history">'+ordered.map((r,i)=>'<option value="'+i+'">'+Q.esc([r.variety,r.origin,r.package,r.size,r.grade,r.quality].filter(Boolean).join(' · '))+'</option>').join('')+'</select></label><div class="reference-quote-stats"></div><div class="reference-chart-layout"><div class="reference-chart"></div><aside class="reference-snapshot"></aside></div><h2 class="reference-all-quotes">All reported quotes</h2>';
 dialog.querySelector('.commodity-dialog__table').before(panel);
 const money=v=>v==null?'—':'$'+Number(v).toFixed(2);
 function show(){const r=ordered[+panel.querySelector('select').value];panel.querySelector('.reference-quote-stats').innerHTML='<div><span>Latest reported range</span><strong>'+money(r.price_low)+(r.price_high!==r.price_low?' – '+money(r.price_high):'')+'</strong><small>USD per '+Q.esc(r.package||'reported package')+'</small></div><div><span>Last report</span><strong>'+Q.esc(r.report_date||'—')+'</strong></div>';
 panel.querySelector('.reference-snapshot').innerHTML='<h3>Market snapshot</h3>'+[['Origin',r.origin],['Variety',r.variety],['Package',r.package],['Size',r.size],['Grade / quality',[r.grade,r.quality].filter(Boolean).join(' · ')]].map(([k,v])=>'<div><span>'+k+'</span><strong>'+Q.esc(v||'—')+'</strong></div>').join('');
 const chart=panel.querySelector('.reference-chart');chart.innerHTML=Q.table(name,[r],market,r.report_date||'');window.agraxQuoteHistory.attach(chart,[r],market);chart.querySelector('.quote-expand')?.click();}
 panel.querySelector('select').onchange=show;show();
};
