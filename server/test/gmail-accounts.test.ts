import test from 'node:test';
import assert from 'node:assert/strict';
import { OAuth2Client } from 'google-auth-library';
import { GoogleGateway } from '../src/gmail.ts';
import { gmailAccountId, gmailSourceId } from '../src/gmail-accounts.ts';
import { CalendarWorker } from '../src/worker.ts';
import { ProviderError } from '../src/errors.ts';
import { fixture, source, provider, mail, interpreter, connection } from './helpers.ts';
import type { GmailConnection } from '../src/domain.ts';
const second = 'second@gmail.com';
const account = (email: string): GmailConnection => ({ ownerId: 'owner', email, status: 'connected', lastSyncAt: null, nextSyncAt: new Date().toISOString(), error: null, warning: null });
function client(email = second) { return Object.assign(new OAuth2Client(), { getToken: async () => ({ tokens: { refresh_token: 'second-refresh', access_token: 'second-access' } }), request: async () => ({ data: { emailAddress: email, historyId: '200' } }), revokeToken: async () => ({}) }) as OAuth2Client; }
test('second inbox OAuth binds the requested address and preserves primary credentials and checkpoint', async () => {
 const f=fixture(); f.store.put('connection','default',connection()); f.store.put('credentials','default',{refresh_token:'primary'}); f.store.put('scan','default',{baseline:'primary-history'});
 try {
  const g=new GoogleGateway(f.config,f.store,()=>client()); const {state,url}=await g.connect('owner',second);
  assert.equal(new URL(url).searchParams.get('login_hint'),second); await g.callback('owner','code',state);
  const id=gmailAccountId(second,f.config.GMAIL_ALLOWED_EMAIL);
  assert.equal(f.store.gmailConnections().length,2); assert.equal(f.store.get<GmailConnection>('connection',id)?.email,second);
  assert.deepEqual(f.store.get('credentials'),{refresh_token:'primary'}); assert.deepEqual(f.store.get('scan'),{baseline:'primary-history'});
  assert.deepEqual(f.store.get('credentials',id),{refresh_token:'second-refresh',access_token:'second-access'});
  await assert.rejects(g.callback('owner','code',state));
 } finally {f.store.close();}
});
test('choosing the existing inbox during an additional connection does not revoke it', async () => {
 const f=fixture(); f.store.put('connection','default',connection()); let revoked=0; const c=client(f.config.GMAIL_ALLOWED_EMAIL); c.revokeToken=async()=>{revoked++;return {} as never;};
 try { const g=new GoogleGateway(f.config,f.store,()=>c);const {state}=await g.connect('owner',second);await assert.rejects(g.callback('owner','code',state),/configured/);assert.equal(revoked,0);assert.equal(f.store.gmailConnections().length,1); } finally {f.store.close();}
});
test('disconnecting an inbox removes only its own sources, credentials, scan and pending consent', async () => {
 const f=fixture();f.store.put('connection','default',connection());const id=gmailAccountId(second,f.config.GMAIL_ALLOWED_EMAIL);f.store.put('connection',id,account(second));f.store.put('credentials',id,{refresh_token:'second'});f.store.put('credentials','default',{refresh_token:'primary'});f.store.put('scan','default',{baseline:'one'});f.store.put('scan',id,{baseline:'two'});
 f.store.capture(source('same'));f.store.capture(source(gmailSourceId(id,'same')));f.store.capture({...source('whatsapp:same'),channel:'whatsapp'});
 try {
  const g=new GoogleGateway(f.config,f.store,()=>client());const {state}=await g.connect('owner',second);await g.disconnect(id);await assert.rejects(g.callback('owner','code',state),/cancelled/);
  assert.equal(f.store.gmailConnections().length,1);assert.ok(f.store.get('credentials'));assert.ok(f.store.get('scan'));assert.equal(f.store.get('credentials',id),undefined);assert.equal(f.store.get('scan',id),undefined);
  assert.ok(f.store.source('same'));assert.ok(f.store.source('whatsapp:same'));assert.equal(f.store.source(gmailSourceId(id,'same')),undefined);
  f.store.put('connection',id,account(second)); f.store.capture(source(gmailSourceId(id,'another')));await g.disconnect();assert.ok(f.store.source(gmailSourceId(id,'another')));assert.ok(f.store.source('whatsapp:same'));assert.equal(f.store.source('same'),undefined);
 } finally {f.store.close();}
});
test('identical provider IDs from two inboxes are captured independently while a duplicate booking appears once', async () => {
 const f=fixture();f.store.put('connection','default',connection());const id=gmailAccountId(second,f.config.GMAIL_ALLOWED_EMAIL);f.store.put('connection',id,account(second));
 const seen:string[]=[];const model=interpreter();const extract=model.extract;model.extract=async(s,e,p,signal)=>{seen.push(s.gmailEmail!);return extract(s,e,p,signal);};
 const worker=new CalendarWorker(f.config,f.store,(_signal,key)=>provider({profile:async()=>({emailAddress:key===id?second:f.config.GMAIL_ALLOWED_EMAIL,historyId:key===id?'200':'100'}),message:async()=>mail('m1')}),model);
 try {await worker.run();assert.ok(f.store.source('m1'));assert.ok(f.store.source(gmailSourceId(id,'m1')));assert.equal(f.store.events().length,1);assert.deepEqual(seen.sort(),[second,f.config.GMAIL_ALLOWED_EMAIL].sort());assert.equal(f.store.get<GmailConnection>('connection',id)?.historyId,'200');assert.equal(f.store.get<GmailConnection>('connection')?.historyId,'100');} finally {await worker.stop();f.store.close();}
});
test('scheduled runs skip a recently checked inbox and failures do not stop the other inbox', async () => {
 const f=fixture();f.store.put('connection','default',connection());const id=gmailAccountId(second,f.config.GMAIL_ALLOWED_EMAIL);f.store.put('connection','default',{...account(f.config.GMAIL_ALLOWED_EMAIL),nextSyncAt:new Date(Date.now()+3600000).toISOString()});f.store.put('connection',id,account(second));const visited:string[]=[];
 const worker=new CalendarWorker(f.config,f.store,(_signal,key)=>{visited.push(key!);return provider({profile:async()=>{if(key==='default')throw new ProviderError(401,true);return {emailAddress:second,historyId:'200'};},list:async()=>({messages:[]})});},interpreter());
 try {await worker.run(false);assert.deepEqual(visited,[id]);visited.length=0;await worker.run();assert.deepEqual(visited,['default',id]);assert.equal(f.store.get<GmailConnection>('connection')?.status,'reconnect_required');assert.equal(f.store.get<GmailConnection>('connection',id)?.status,'connected');} finally {await worker.stop();f.store.close();}
});

test('credential refresh stays scoped and a stale client cannot restore disconnected or replaced credentials', async () => {
 const f=fixture();const id=gmailAccountId(second,f.config.GMAIL_ALLOWED_EMAIL);f.store.put('credentials','default',{refresh_token:'primary'});f.store.put('credentials',id,{refresh_token:'second'});
 const clients:OAuth2Client[]=[];const g=new GoogleGateway(f.config,f.store,()=>{const c=client();clients.push(c);return c;});
 try {
  g.connectedProvider(undefined,id);clients[0]!.emit('tokens',{access_token:'renewed'});assert.equal(f.store.get<{access_token:string}>('credentials',id)?.access_token,'renewed');assert.deepEqual(f.store.get('credentials'),{refresh_token:'primary'});
  f.store.put('credentials',id,{refresh_token:'replacement'});clients[0]!.emit('tokens',{access_token:'stale'});assert.deepEqual(f.store.get('credentials',id),{refresh_token:'replacement'});
  await g.disconnect(id);clients[0]!.emit('tokens',{access_token:'late'});assert.equal(f.store.get('credentials',id),undefined);
 } finally {f.store.close();}
});
