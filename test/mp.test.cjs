const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');
const root = path.join(__dirname, '..');
// Synthetic test credentials only. No calls to live services.
process.env.CLIENT_1_ID = 'test-client';
process.env.CLIENT_1_TOKEN = 'test-token';
process.env.TWFY_API_KEY = 'test-key';
const emails = require('../api/data/emails.json');
const helper = require('../lib/postcode-fallback');
const names = require('../lib/postcodes/names.json');
function fresh() {
  delete require.cache[require.resolve('../api/mp')];
  return require('../api/mp');
}
function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}
const auth = { 'x-client-id': 'test-client', 'x-client-token': 'test-token' };
async function call(handler, options = {}) {
  const res = { headers: {}, setHeader(k,v) { this.headers[k] = v; }, end(s) { this.body = s ? JSON.parse(s) : null; } };
  await handler({ method: 'GET', headers: auth, query: { postcode: 'SN15 1AA' }, ...options }, res);
  return res;
}
const data = zlib.gunzipSync(fs.readFileSync(path.join(root,'lib/postcodes/lookup.bin.gz')));
function findPostcode(con) {
  const id = names.indexOf(con);
  for (let at=0;at<data.length;at+=9) if(data.readUInt16LE(at+7)===id) return data.toString('ascii',at,at+7).trim();
}
const validPC = findPostcode('Chippenham');
const request = { query: { postcode: validPC } };

test('auth, preflight, missing input and missing API key preserve behavior without fetching', async () => {
  global.fetch = async () => { throw new Error('Unexpected fetch'); };
  const h = fresh();
  assert.equal((await call(h,{method:'OPTIONS',headers:{}})).statusCode,200);
  assert.equal((await call(h,{headers:{}})).statusCode,401);
  assert.equal((await call(h,{headers:{...auth,'x-client-token':'wrong'}})).statusCode,403);
  assert.equal((await call(h,{query:{}})).statusCode,400);
  delete process.env.TWFY_API_KEY;
  assert.equal((await call(h,request)).statusCode,500);
  process.env.TWFY_API_KEY='test-key';
});

test('successful primary keeps response fields, curated override, and contact URL', async () => {
  const row = emails.find(r=>r.constituency==='Chippenham');
  global.fetch = async url => response(url.includes('raw.githubusercontent') ? emails :
    {name:row.mp_name,party:row.party,email:'upstream@example.org',constituency:row.constituency,person_id:123});
  const res = await call(fresh(),request);
  assert.equal(res.statusCode,200);
  assert.deepEqual(res.body,{name:row.mp_name,party:row.party,email:row.email,constituency:row.constituency,
    person_id:123,contact_url:'https://www.theyworkforyou.com/mp/?p=123'});
});

test('existing getPerson and getMPs recovery still work',async()=>{
  for(const fixture of [{person_id:123},{constituency:'Chippenham'}]) {
    global.fetch=async url=>response(url.includes('raw.githubusercontent')?emails:
      url.includes('/getMP?')?fixture:[{name:'Test Member',party:'Test',email:'test@example.org',constituency:'Chippenham',person_id:123}]);
    const res=await call(fresh(),request);assert.equal(res.statusCode,200);assert.equal(res.body.name,'Test Member');
    assert.equal(res.body.email,emails.find(r=>r.constituency==='Chippenham').email);
  }
});

test('array response normalization and upstream-email behavior when GitHub unavailable',async()=>{
  global.fetch=async url=>url.includes('raw.githubusercontent')?response(null,503):response([
    {full_name:'Test Member',party:'Test',email:'test@example.org',constituency:'Chippenham',id:9}]);
  const res=await call(fresh(),request);assert.equal(res.statusCode,200);assert.equal(res.body.name,'Test Member');
  assert.equal(res.body.email,'test@example.org');assert.equal(res.body.person_id,9);
});

test('server errors, rate limits, network errors, JSON errors and unusable data use offline fallback',async()=>{
  for(const failure of ['503','429','network','json','empty']) {
    let calls=0;
    global.fetch=async()=>{calls++;if(failure==='network')throw new Error('Synthetic network failure');
      if(failure==='json')return {ok:true,status:200,json:async()=>{throw new Error('Malformed JSON');}};
      return response(failure==='empty'?{}:null,failure==='empty'?200:Number(failure));};
    const res=await call(fresh(),request);assert.equal(res.statusCode,200);assert.equal(res.body.constituency,'Chippenham');
    assert.equal(res.body.person_id,null);assert.equal(res.body.contact_url,null);assert.ok(res.body.email);assert.equal(calls,1);
  }
});

test('timeout during fetch and response-body read triggers fallback',async()=>{
  const original=global.setTimeout;
  global.setTimeout=(fn,ms,...args)=>original(fn,Math.min(ms,5),...args);
  try {
    for(const body of [false,true]) {
      global.fetch=async(url,{signal})=>{
        const pending=()=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true}));
        return body?{ok:true,status:200,json:pending}:pending();
      };
      assert.equal((await call(fresh(),request)).body.constituency,'Chippenham');
    }
  }finally{global.setTimeout=original;}
});

test('upstream client errors remain unchanged',async()=>{
  for(const status of [400,401,403,404]){
    global.fetch=async()=>response(null,status);const res=await call(fresh(),request);
    assert.equal(res.statusCode,status);assert.deepEqual(res.body,{error:`TWFY ${status}`});
  }
});

test('exact normalized lookup, reviewed filename aliases, and coverage exclusions',()=>{
  assert.deepEqual(helper.lookup(validPC.toLowerCase()),helper.lookup(validPC));
  assert.deepEqual(helper.lookup(validPC),helper.lookup(validPC.slice(0,-3)+' '+validPC.slice(-3)));
  for(const con of ['Ashford','Gorton and Denton','Montgomeryshire and Glyndŵr','Ynys Môn']){
    assert.equal(helper.lookup(findPostcode(con)).constituency,con);
  }
  for(const value of ['B1','ZZ99 9ZZ','SN15!1AA',null,[], 'x'.repeat(100)])assert.equal(helper.lookup(value),null);
  assert.equal(findPostcode('Birmingham Ladywood'),undefined);
  assert.equal(findPostcode('Aberafan Maesteg'),undefined);
  // Check sampled records including the first and last against decoded IDs.
  for(let i=0;i<data.length/9;i+=997){
    const pc=data.toString('ascii',i*9,i*9+7).trim();const con=names[data.readUInt16LE(i*9+7)];
    const row=emails.find(r=>r.constituency===con);const result=helper.lookup(pc);
    if(row.email)assert.equal(result.constituency,con);else assert.equal(result,null);
  }
  const end=data.length-9;const result=helper.lookup(data.toString('ascii',end,end+7).trim());
  assert.equal(result.constituency,names[data.readUInt16LE(end+7)]);
});

test('unknown postcode and missing curated email produce controlled outage error',async()=>{
  global.fetch=async()=>response(null,503);
  for(const pc of ['ZZ99 9ZZ',findPostcode(emails.find(r=>!r.email && findPostcode(r.constituency)).constituency)]){
    const res=await call(fresh(),{query:{postcode:pc}});assert.equal(res.statusCode,503);assert.ok(res.body.error);
  }
});

test('corrupt fallback is contained and cannot affect a successful primary',async()=>{
  const read=fs.readFileSync;
  delete require.cache[require.resolve('../lib/postcode-fallback')];
  fs.readFileSync=function(file,...args){if(String(file).endsWith('lookup.bin.gz'))return Buffer.from('corrupt');return read.call(this,file,...args);};
  try {
    global.fetch=async()=>response(null,503);const res=await call(fresh(),request);assert.equal(res.statusCode,503);
    global.fetch=async url=>response(url.includes('raw.githubusercontent')?emails:{name:'Test',email:'test@example.org',constituency:'Chippenham',person_id:1});
    assert.equal((await call(fresh(),request)).statusCode,200);
  }finally{fs.readFileSync=read;delete require.cache[require.resolve('../lib/postcode-fallback')];}
});
