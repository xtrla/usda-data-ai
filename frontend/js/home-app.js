/* AgraX home: one responsive layout, backed by the current terminal reports. */
(function(){
'use strict';
var api=window.agraxAPI,scope,template,host,pending=false;
var priority=['New York','Los Angeles','Chicago','Philadelphia','Miami','Boston','Atlanta','Dallas','Baltimore','Detroit','St. Louis','Columbia'];
function paint(){
 if(pending)return;pending=true;
 requestAnimationFrame(function(){
  pending=false;
  var input=host.querySelector('[data-search-input]');
  var focused=input===document.activeElement;
  window.DC.mount(host,template,scope);
  if(window.agraxAccountUI)window.agraxAccountUI.mount();
  if(window.agraxSearch)window.agraxSearch.rebind();
  if(focused)host.querySelector('[data-search-input]').focus({preventScroll:true});
 });
}
function applyRows(rows){
 if(window.agraxSearch)window.agraxSearch.attach(rows,function(hit){location.href='/browse?market='+encodeURIComponent(hit.market||'')+'&c='+encodeURIComponent(hit.commodity);});
 var markets={},categories={};
 rows.forEach(function(r){
  if(r.market){var m=markets[r.market]||(markets[r.market]={count:0,dates:[]});m.count++;if(r.report_date)m.dates.push(r.report_date.slice(0,10));}
  if(r.commodity){var key=r.commodity_type||'vegetables';(categories[key]||(categories[key]={}))[r.commodity]=true;}
 });
 var terminals=Object.keys(markets).sort(function(a,b){var ar=priority.indexOf(a),br=priority.indexOf(b);return (ar<0?99:ar)-(br<0?99:br)||a.localeCompare(b);}).map(function(name){
  var m=markets[name],dates=[...new Set(m.dates)].sort();
  var date=dates.length?(dates.length===1?window.agraxUtil.fmtDate(dates[0]):'Mixed report dates'):'Date unavailable';
  return {name:name,date:date,lines:m.count.toLocaleString(),href:'/browse?market='+encodeURIComponent(name)};
 });
 scope.featuredMarkets=terminals.slice(0,6);scope.moreMarkets=terminals.slice(6);scope.hasMoreMarkets=terminals.length>6;
 scope.marketStatus=terminals.length?'':'No market reports available right now.';
 [['fruits','catFruit'],['vegetables','catVegetables'],['onions_potatoes','catOnions'],['nuts','catNuts']].forEach(function(pair){scope[pair[1]]=Object.keys(categories[pair[0]]||{}).length.toLocaleString();});
 paint();
}
function boot(){
 host=document.getElementById('page-root');template=document.getElementById('page-template').innerHTML;
 scope={query:'',marketStatus:'Loading available reports…',featuredMarkets:[],moreMarkets:[],hasMoreMarkets:false,catFruit:'—',catVegetables:'—',catOnions:'—',catNuts:'—'};
 scope.onQuery=function(e){scope.query=e.target.value;};
 scope.onSearch=function(e){e.preventDefault();var input=host.querySelector('[data-search-input]');location.href='/browse?q='+encodeURIComponent(input.value.trim());};
 host.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.defaultPrevented&&e.target.matches('[data-search-input]'))scope.onSearch(e);});
 paint();
 (api.reportCurrent?api.reportCurrent('terminal'):api.reportLatest('terminal')).then(applyRows).catch(function(){api.reportLatest('terminal').then(applyRows).catch(function(){scope.marketStatus='Markets could not load. You can still search or browse by category.';paint();});});
}
document.addEventListener('DOMContentLoaded',boot);
})();
