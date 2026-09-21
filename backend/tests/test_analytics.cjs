const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../../frontend/js/analytics.js'),'utf8');
function fixture({id='G-TEST123',host='www.agra-x.com',search='',pathname='/',consent=null}={}){
 const scripts=[],nodes=[];
 function element(){const buttons={};return {hidden:false,setAttribute(){},append(){},querySelector(k){return buttons[k] ||= {focus(){}};}};}
 const context={location:{hostname:host,origin:'https://'+host,pathname,search,hash:''},localStorage:{getItem(){return consent},setItem(k,v){consent=v}},document:{createElement:element,head:{append(s){scripts.push(s)}},body:{append(n){nodes.push(n)}},querySelector(){return null}}};
 context.window=context;context.AGRAX_GA_ID=id;vm.runInNewContext(source,context);
 return {context,scripts,nodes};
}
test('no tracking without consent or configuration',()=>{assert.equal(fixture().scripts.length,0);assert.equal(fixture({id:''}).nodes.length,0);});
test('local development and token pages never load analytics',()=>{for(const opts of [{host:'localhost'},{search:'?code=private'},{pathname:'/newsletter'}])assert.equal(fixture({...opts,consent:'granted'}).scripts.length,0);});
test('accept loads once and strips private URL fields',()=>{const f=fixture({search:'?email=private@example.com'});f.nodes[0].querySelector('[data-accept]').onclick();f.nodes[0].querySelector('[data-accept]').onclick();assert.equal(f.scripts.length,1);assert.ok(!JSON.stringify(f.context.dataLayer).includes('private@example'));});
test('decline and revoke disable measurement',()=>{const f=fixture({consent:'granted'});assert.equal(f.scripts.length,1);f.nodes[0].querySelector('[data-decline]').onclick();assert.equal(f.context['ga-disable-G-TEST123'],true);});
