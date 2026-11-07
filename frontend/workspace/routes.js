(function(root){
  function resolve(path,search,hash){
    const p=Object.fromEntries(new URLSearchParams(search));
    path=path.replace(/\/$/,'')||'/';
    if(p.commodity&&!p.c)p.c=p.commodity;
    if(p.quote_id&&!p.id)p.id=p.quote_id;
    if(/^#(?:manage|confirm)=/.test(hash||''))p.view='manage';
    else if(hash==='#newsletter-heading')p.view='email';
    else if(!p.view){
      if(path==='/reports')p.view=p.market&&p.category?'report':'reports';
      else if(path==='/newsletter')p.view='manage';
      else if(path==='/about')p.view='about';
      else if(path==='/privacy')p.view='privacy';
      else if(path==='/watchlist')p.view='saved';
      else if(p.id)p.view='quote';
      else if(p.c)p.view='product';
      else if(p.market||p.q||['/browse','/markets','/app','/app/commodity'].includes(path))p.view='explore';
      else p.view=path==='/'?'home':'notfound';
    }
    return p;
  }
  root.AgraXRoutes={resolve};
})(typeof window==='undefined'?globalThis:window);
