const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname,'../../frontend/js/account-client.js'),'utf8');
function fixture(initial = null) {
  let session = initial, callback, failWrite = false, googleEnabled = true;
  const rows = [{user_id:'alice',commodity:'Apples'}, {user_id:'bob',commodity:'Onions'}];
  const auth = {
    onAuthStateChange(fn) { callback = fn; },
    async getSession() { return {data:{session: session ? {user:session}:null}}; },
    async signInWithPassword({email}) { session = {id:email,user_metadata:{preferred_market:'Chicago'}}; return {data:{user:session}}; },
    async signUp(input) { this.signup = input; return {data:{session:null,user:{id:'new'}}}; },
    async signInWithOAuth(input) { this.oauth = input; return this.oauthError ? {error:this.oauthError} : {data:{}}; },
    async signOut() { session = null; return {}; },
    async updateUser(input) { session = {...session,user_metadata:{...session.user_metadata,...input.data}}; return {data:{user:session}}; },
    async resetPasswordForEmail() { return {}; }
  };
  const client = {auth,from(table) {
    assert.equal(table,'watchlist_items');
    let operation = '', filters = {}, item;
    const query = {
      select(){operation='select';return this;},
      eq(key,value){filters[key]=value;return this;},
      order(){return this;},
      insert(value){operation='insert';item=value;return this;},
      delete(){operation='delete';return this;},
      then(resolve,reject){
        if (failWrite && operation !== 'select') return Promise.resolve({error:Error('offline')}).then(resolve,reject);
        const matches = row => Object.entries(filters).every(([key,value]) => row[key] === value);
        if(operation === 'insert') rows.push(item);
        if(operation === 'delete') for(let i=rows.length-1;i>=0;i--) if(matches(rows[i])) rows.splice(i,1);
        return Promise.resolve({data:rows.filter(matches).map(row=>({...row}))}).then(resolve,reject);
      }
    }; return query;
  }};
  const window = {supabase:{createClient:()=>client},AGRAX_SUPABASE_URL:'url',AGRAX_SUPABASE_ANON_KEY:'public'};
  vm.runInNewContext(source,{window,URL,fetch:async()=>({ok:true,json:async()=>({external:{google:googleEnabled}})}),location:{origin:'https://example.test',pathname:'/browse',search:'?market=Boston'},setTimeout});
  return {account:window.agraxAccount,rows,auth,disableGoogle:()=>{googleEnabled=false;},fail:()=>{failWrite=true;}};
}
test('public visitors cannot save; signup persists market and returns confirmation state',async()=>{
 const f=fixture(); await f.account.ready;
 await assert.rejects(f.account.toggle('Apples'),/Sign in/);
 assert.equal(await f.account.signUp('test@example.test','password','Boston'),false);
 assert.equal(f.auth.signup.options.data.preferred_market,'Boston');
 assert.equal(f.account.user(),null);
});
test('watchlists remain account scoped across signout and switching users',async()=>{
 const f=fixture({id:'alice',user_metadata:{preferred_market:'Boston'}}); await f.account.ready;
 assert.equal(f.account.watch().join(','),'Apples');
 await f.account.toggle('Pears'); assert.equal(f.rows.find(r=>r.commodity==='Pears').user_id,'alice');
 await f.account.signOut(); assert.equal(f.account.watch().length,0); assert.equal(f.account.preferredMarket(),'');
 await f.account.signIn('bob','password'); assert.equal(f.account.watch().join(','),'Onions');
 await f.account.toggle('Onions'); assert.equal(f.account.watch().length,0);
 assert.ok(f.rows.find(r=>r.user_id==='alice'&&r.commodity==='Apples'));
});
test('failed writes do not claim a save or erase existing items',async()=>{
 const f=fixture({id:'alice'});await f.account.ready;f.fail();
 await assert.rejects(f.account.toggle('Pears'),/offline/);assert.equal(f.account.has('Pears'),false);
 await assert.rejects(f.account.toggle('Apples'),/offline/);assert.equal(f.account.has('Apples'),true);
 assert.equal(f.account.pending('Apples'),false);
});
test('preferred market survives a profile update',async()=>{
 const f=fixture({id:'alice',user_metadata:{preferred_market:'Boston'}});await f.account.ready;
 await f.account.saveMarket('Chicago');assert.equal(f.account.preferredMarket(),'Chicago');
 await f.account.saveMarket('');assert.equal(f.account.preferredMarket(),'');
});
test('missing SDK keeps public browsing usable with a clear account error',async()=>{
 const window={};vm.runInNewContext(source,{window,setTimeout});await window.agraxAccount.ready;
 await assert.rejects(window.agraxAccount.signIn('a','b'),/temporarily unavailable/);
});
test('explicit market links win over preferences; unavailable preferences fall back',async()=>{
 const f=fixture({id:'alice',user_metadata:{preferred_market:'Chicago'}});await f.account.ready;
 const markets=['Boston','Chicago','New York'];
 assert.equal(f.account.initialMarket(markets,null),'Chicago');
 assert.equal(f.account.initialMarket(markets,'Boston'),'Boston');
 assert.equal(f.account.initialMarket(['Boston','New York'],null),'New York');
 assert.equal(f.account.initialMarket(['Boston'],null),'Boston');
 await f.account.signOut();assert.equal(f.account.initialMarket(markets,null),'New York');
});

test('Google is the only OAuth provider and returns to the current market',async()=>{
 const f=fixture();await f.account.ready;await f.account.signInWithGoogle();
 assert.equal(f.auth.oauth.provider,'google');
 assert.equal(f.auth.oauth.options.redirectTo,'https://example.test/browse?market=Boston&account=google');
 assert.equal(f.account.user(),null);
 f.auth.oauthError=Error('Provider is disabled');
 await assert.rejects(f.account.signInWithGoogle(),/Provider is disabled/);
});

test('disabled Google provider reports an error without leaving the page',async()=>{
 const f=fixture();await f.account.ready;f.disableGoogle();
 await assert.rejects(f.account.signInWithGoogle(),/not available yet/);
 assert.equal(f.auth.oauth,undefined);
});
