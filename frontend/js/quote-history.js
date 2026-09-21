(function(root){
'use strict';
const fields=['commodity','market','variety','origin','package','size','grade','quality','quality_note','properties','appearance','condition','notes','price_notes','price_qualifier','organic'];
const clean=v=>v==null?'':String(v).trim();
function sameQuote(a,b){return fields.every(k=>clean(a[k])===clean(b[k]));}
const number=v=>v==null||String(v).trim()===''||!Number.isFinite(+v)?null:+v;
function observations(rows,quote){
  const seen=new Set();
  return rows.filter(r=>sameQuote(r,quote)).map(r=>{
    const day=String(r.report_date||'').slice(0,10),time=Date.parse(day+'T00:00:00Z');
    const low=number(r.price_low),high=number(r.price_high);
    return {day,time,low,high,mostlyLow:number(r.price_mostly_low),mostlyHigh:number(r.price_mostly_high)};
  }).filter(p=>{
    if(!/^\d{4}-\d{2}-\d{2}$/.test(p.day)||!Number.isFinite(p.time)||(p.low===null&&p.high===null))return false;
    if(p.low!==null&&p.high!==null&&p.low>p.high)return false;
    const key=JSON.stringify(p);if(seen.has(key))return false;seen.add(key);return true;
  }).sort((a,b)=>a.time-b.time);
}
function attach(container,items,market){
  const Q=root.agraxQuotes, ordered=items.slice().sort(Q.compareQuotes);
  let active=null,version=0;
  const cache=new Map();
  const money=v=>v===null?'—':'$'+v.toFixed(2);
  const range=(a,b)=>a!==null&&b!==null?(a===b?money(a):money(a)+'–'+money(b)):a!==null?money(a)+' (low only)':b!==null?money(b)+' (high only)':'—';
  const chart=(points,demo=false)=>{
    const values=points.flatMap(p=>[p.low,p.high,p.mostlyLow,p.mostlyHigh]).filter(v=>v!==null);
    let lo=Math.min(...values),hi=Math.max(...values);const pad=Math.max((hi-lo)*.15,1);lo=Math.max(0,lo-pad);hi+=pad;
    const start=points[0].time,end=points[points.length-1].time;
    const x=t=>60+(end===start?250:500*(t-start)/(end-start)), y=v=>180-145*(v-lo)/(hi-lo);
    let svg='<svg viewBox="0 0 620 220" role="img" aria-label="Reported price ranges by date in US dollars. Exact values follow below.">';
    for(let i=0;i<4;i++){const val=lo+(hi-lo)*i/3;svg+='<line x1="60" x2="560" y1="'+y(val)+'" y2="'+y(val)+'" stroke="#e2e8dc"/><text x="50" y="'+(y(val)+4)+'" text-anchor="end">'+money(val)+'</text>';}
    if(demo){
      const upper=points.map(p=>x(p.time)+','+y(p.high)).join(' ');
      const lower=points.slice().reverse().map(p=>x(p.time)+','+y(p.low)).join(' ');
      svg+='<polygon points="'+upper+' '+lower+'" fill="#dae8d3" opacity=".7"/>';
      svg+='<polyline points="'+points.map(p=>x(p.time)+','+y((p.low+p.high)/2)).join(' ')+'" fill="none" stroke="#245434" stroke-width="2.5" stroke-linejoin="round"/>';
    }
    for(const p of points){const px=x(p.time),low=p.low??p.high,high=p.high??p.low;svg+='<g><title>'+Q.esc(p.day+': '+range(p.low,p.high)+'; mostly '+range(p.mostlyLow,p.mostlyHigh))+'</title>';
      if(demo)svg+='<circle cx="'+px+'" cy="'+y((low+high)/2)+'" r="3.5" fill="#245434"/>';
      else if(low===high)svg+='<circle cx="'+px+'" cy="'+y(low)+'" r="4" fill="#779b68"/>';
      else svg+='<rect x="'+(px-4)+'" y="'+y(high)+'" width="8" height="'+Math.max(2,y(low)-y(high))+'" rx="3" fill="#779b68"/>';
      if(!demo&&(p.mostlyLow!==null||p.mostlyHigh!==null))svg+='<line x1="'+px+'" x2="'+px+'" y1="'+y(p.mostlyLow??p.mostlyHigh)+'" y2="'+y(p.mostlyHigh??p.mostlyLow)+'" stroke="#173d27" stroke-width="4" stroke-linecap="round"/>';
      svg+='</g>';}
    return svg+'<text x="60" y="208">'+points[0].day+'</text><text x="560" y="208" text-anchor="end">'+points[points.length-1].day+'</text></svg>';
  };
  container.querySelectorAll('tbody > tr').forEach((tr,index)=>{
    const quote=ordered[index];if(!quote)return;
    const button=document.createElement('button');button.type='button';button.className='quote-history-toggle';button.textContent='Price history';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','quote-history-'+index);
    tr.querySelector('.price').append(button);
    button.addEventListener('click',()=>{
      const closing=active?.button===button;
      if(active){active.row.remove();active.button.setAttribute('aria-expanded','false');active=null;}version++;
      if(closing)return;
      button.setAttribute('aria-expanded','true');
      const row=document.createElement('tr');row.className='quote-history-row';row.id='quote-history-'+index;
      const cell=document.createElement('td');cell.colSpan=7;row.append(cell);tr.after(row);active={row,button};
      cell.innerHTML='<section class="quote-history-panel" aria-label="Price history"><div class="quote-history-heading"><div><h3>Price history</h3><p>'+Q.esc([market,quote.commodity,quote.variety,quote.origin,quote.package,quote.size,quote.grade,quote.quality,quote.quality_note,quote.properties,quote.organic===true?'Organic':''].filter(Boolean).join(' · '))+'</p></div><button type="button" class="quote-history-close" aria-label="Close price history">×</button></div><div class="quote-history-periods" aria-label="History period">'+[[30,'30 days'],[90,'90 days'],[365,'1 year']].map(([days,label])=>'<button type="button" data-days="'+days+'" aria-pressed="'+(days===30)+'">'+label+'</button>').join('')+'</div><div class="quote-history-content" role="status"></div></section>';
      cell.querySelector('.quote-history-close').onclick=()=>{button.click();button.focus();};
      const content=cell.querySelector('.quote-history-content');
      let demo=false,period=30;
      if(['localhost','127.0.0.1'].includes(location.hostname)){
        const preview=document.createElement('button');preview.type='button';preview.className='quote-history-demo-toggle';preview.textContent='Preview with sample data';
        cell.querySelector('.quote-history-periods').after(preview);
        preview.onclick=()=>{demo=!demo;preview.textContent=demo?'Return to real history':'Preview with sample data';load(period);};
      }
      function samples(days){
        const changes=[0,1,2,-1,-2,0,3,5,4,2,3,6,5,4,7];
        const base=number(quote.price_low)??40;
        const today=new Date();today.setUTCHours(0,0,0,0);
        return changes.map((change,i)=>({...quote,report_date:new Date(+today-(changes.length-1-i)*Math.max(1,Math.floor((days-1)/14))*86400000).toISOString().slice(0,10),price_low:Math.max(1,base+change-2),price_high:Math.max(5,base+change+2),price_mostly_low:null,price_mostly_high:null}));
      }
      async function load(days){
        period=days;
        const token=++version;
        cell.querySelectorAll('[data-days]').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.days===days)));
        content.textContent='Loading matching reports…';
        try{
          let data=demo?samples(days):cache.get(index);
          if(!data){
            data=await root.agraxAPI.history({commodity:quote.commodity,market,variety:quote.variety||'',origin:quote.origin||'',package:quote.package||'',size:quote.size||'',grade:quote.grade||'',days:365});
            if(!Array.isArray(data))throw Error('Invalid history response');cache.set(index,data);
          }
          if(token!==version||!row.isConnected)return;
          const cutoff=new Date();cutoff.setUTCHours(0,0,0,0);cutoff.setUTCDate(cutoff.getUTCDate()-days);
          const points=observations(data,quote).filter(p=>p.time>=+cutoff&&p.time<=Date.now());
          if(!points.length){content.textContent='No matching price history in this period. Try a longer period. Only the same product specification is included.';return;}
          const dates=new Set(points.map(p=>p.day));
          if(demo){
            content.innerHTML='<div class="quote-history-demo-banner">DESIGN PREVIEW · Sample prices, not USDA data</div><div class="quote-history-combo"><div><p class="quote-history-caption">Line: calculated midpoint · Shading: sample low–high range<br>USD per package · '+points.length+' sample dates</p>'+chart(points,true)+'</div><div class="quote-history-list"><h4>Price observations</h4><div class="quote-history-list-labels"><span>Date</span><span>Range / midpoint</span></div><ul class="quote-history-values">'+points.slice().reverse().map(p=>'<li><time>'+p.day+'</time><span>'+Q.esc(range(p.low,p.high))+'<small>Midpoint '+money((p.low+p.high)/2)+'</small></span></li>').join('')+'</ul></div></div>';
            return;
          }
          content.innerHTML='<p class="quote-history-caption">'+dates.size+' report date'+(dates.size===1?'':'s')+' · USD per reported package'+(dates.size===1?'. One date is not enough to show a trend.':'. Each mark is a reported range; gaps are not filled.')+'</p>'+(dates.size>1?chart(points):'')+'<details'+(dates.size===1?' open':'')+'><summary>Reported values</summary><ul class="quote-history-values">'+points.map(p=>'<li><time>'+p.day+'</time><span>'+Q.esc(range(p.low,p.high))+(p.mostlyLow!==null||p.mostlyHigh!==null?'<small>Mostly '+Q.esc(range(p.mostlyLow,p.mostlyHigh))+'</small>':'')+'</span></li>').join('')+'</ul></details>'+(dates.size>1?'<p class="quote-history-caption">Light green: reported range · Dark green: mostly, when supplied. Multiple quotes on one date are not averaged.</p>':'');
        }catch(error){if(token!==version||!row.isConnected)return;content.textContent='Could not load price history. ';const retry=document.createElement('button');retry.type='button';retry.textContent='Try again';retry.onclick=()=>load(days);content.append(retry);}
      }
      cell.querySelectorAll('[data-days]').forEach(b=>b.onclick=()=>load(+b.dataset.days));load(30);
    });
  });
}
root.agraxQuoteHistory={sameQuote,observations,attach};
})(typeof window!=='undefined'?window:globalThis);
