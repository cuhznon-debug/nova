import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import Database from 'better-sqlite3';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { SQLite3Store } from '@bleed-believer/connect-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

const DATA_DIR = process.env.NOVA_DATA_DIR || __dirname;
const fs = await import('node:fs');
fs.mkdirSync(DATA_DIR, {recursive:true});
const db = new Database(path.join(DATA_DIR, 'nova.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

app.use(express.json({ limit: '12mb' }));
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'nova-dev-change-this-secret',
  store: new SQLite3Store(path.join(DATA_DIR, 'sessions.sqlite')),
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 30 }
});
app.use(sessionMiddleware);

const GROUPS = [
  {id:'anime',name:'Anime Hub',icon:'✦',desc:'Talk seasons, characters, theories and everything anime.',members:284},
  {id:'gaming',name:'Gaming Squad',icon:'⌁',desc:'Game nights, clips, builds and competitive chaos.',members:128},
  {id:'music',name:'Music Room',icon:'♫',desc:'Share what you’re listening to and discover new sounds.',members:96},
  {id:'creators',name:'Creators',icon:'✎',desc:'A creative corner for artists, editors and makers.',members:73},
  {id:'late',name:'Late Night',icon:'☾',desc:'For conversations that somehow last until sunrise.',members:61},
  {id:'tech',name:'Tech Lab',icon:'⌘',desc:'Build, experiment, troubleshoot and ship cool stuff.',members:112}
];
const PROFILES = {
  edwin:{name:'Edwin',handle:'edwin',bio:'just building cool stuff ✦ anime • gaming • music',tags:['Gaming','Creator','Custom Profile'],accent:'#8b5cf6',avatar:null,banner:null},
  mika:{name:'Mika',handle:'mika',bio:'anime, art & late-night conversations ✦',tags:['Anime','Artist'],accent:'#f97316',avatar:null,banner:null},
  jay:{name:'Jay',handle:'jay',bio:'building things and breaking them again.',tags:['Developer','Creator'],accent:'#3b82f6',avatar:null,banner:null},
  kai:{name:'Kai',handle:'kai',bio:'music / games / good vibes',tags:['Music','Gaming'],accent:'#10b981',avatar:null,banner:null},
  luna:{name:'Luna',handle:'luna',bio:'soft chaos ✦',tags:['Music','Anime'],accent:'#a855f7',avatar:null,banner:null}
};

// Real relational data replaces the old single JSON blob. Profile/settings JSON remains intentionally flexible.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL,
  profile_json TEXT NOT NULL, settings_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS friendships (
  user_id TEXT NOT NULL, friend_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, friend_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(friend_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS friend_requests (
  id TEXT PRIMARY KEY, from_user TEXT NOT NULL, to_user TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(from_user,to_user), FOREIGN KEY(from_user) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(to_user) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, user_a TEXT, user_b TEXT, group_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_a,user_b), FOREIGN KEY(user_a) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(user_b) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, sender_id TEXT NOT NULL, body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE, FOREIGN KEY(sender_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS group_members (
  group_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(group_id,user_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id,created_at);
CREATE INDEX IF NOT EXISTS idx_requests_to ON friend_requests(to_user,status);
`);

const nowTime = () => new Date().toLocaleTimeString([], {hour:'numeric', minute:'2-digit'});
const id = prefix => `${prefix}_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;
const pairId = (a,b) => [a,b].sort().join('__');
const defaultSettings = () => ({online:true,sounds:true,compact:false,dark:true});
const defaultProfile = key => PROFILES[key] || {name:'Nova User',handle:key,bio:'New to Nova ✦',tags:['New here'],accent:'#8b5cf6',avatar:null,banner:null};
const json = (v,fallback={}) => { try{return JSON.parse(v)}catch{return fallback} };

function seed(){
  if(db.prepare('SELECT COUNT(*) c FROM users').get().c) return;
  const insertUser=db.prepare('INSERT INTO users(id,email,password_hash,profile_json,settings_json) VALUES(?,?,?,?,?)');
  const tx=db.transaction(()=>{
    for(const key of Object.keys(PROFILES)) insertUser.run(key,`${key}@nova.local`,bcrypt.hashSync('nova123',10),JSON.stringify(defaultProfile(key)),JSON.stringify(defaultSettings()));
    const friend=db.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id) VALUES(?,?)');
    friend.run('edwin','mika'); friend.run('mika','edwin');
  });
  tx();
  db.prepare('INSERT OR IGNORE INTO friend_requests(id,from_user,to_user,status) VALUES(?,?,?,?)').run(id('req'),'luna','edwin','pending');
  for(const g of GROUPS.slice(0,3)) db.prepare('INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES(?,?)').run(g.id,'edwin');
  const conv=db.prepare('INSERT OR IGNORE INTO conversations(id,type,user_a,user_b) VALUES(?,?,?,?)');
  const msg=db.prepare('INSERT INTO messages(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)');
  for(const other of ['mika','jay','luna','kai']) conv.run(`dm_${pairId('edwin',other)}`,'dm',...['edwin',other].sort());
  const samples=[
    ['mika','Hey! You finally made Nova? 👀'],['edwin','Yep 😭 Prototype 2 is alive.'],['mika','Okay wait, this actually looks so clean.'],['edwin',"I'm trying to make it feel like its own thing."],
    ['jay','You still working on that app?'],['edwin','Always. Never escaping the build loop lol'],['luna','Late night Nova testing?'],['edwin','Obviously.'],['kai','Send me that playlist when you get a chance.']
  ];
  const convM=`dm_${pairId('edwin','mika')}`, convJ=`dm_${pairId('edwin','jay')}`, convL=`dm_${pairId('edwin','luna')}`, convK=`dm_${pairId('edwin','kai')}`;
  for(const [sender,body] of samples) msg.run(id('msg'), sender==='mika'||sender==='edwin' ? convM : sender==='jay'?convJ:sender==='luna'?convL:convK, sender, body, new Date().toISOString());
  const gc=db.prepare('INSERT OR IGNORE INTO conversations(id,type,group_id) VALUES(?,?,?)');
  for(const g of GROUPS) gc.run(`group_${g.id}`,'group',g.id);
  const gm=db.prepare('INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES(?,?)');
  for(const u of ['mika','jay','luna','kai','edwin']) for(const g of GROUPS.slice(0,1)) gm.run(g.id,u);
  msg.run(id('msg'),'group_anime','mika','Anyone watching the new season?','2026-10-07T21:42:00.000Z');
  msg.run(id('msg'),'group_anime','jay','I started it yesterday. No spoilers pls 😭','2026-10-07T21:45:00.000Z');
  msg.run(id('msg'),'group_anime','luna','Too late, I already finished it.','2026-10-07T21:48:00.000Z');
}
seed();

const presence=new Map();
function publicUser(row){
  const p=json(row.profile_json,defaultProfile(row.id));
  return {id:row.id,name:p.name,handle:'@'+p.handle,bio:p.bio||'',tags:p.tags||[],accent:p.accent||'#8b5cf6',avatar:p.avatar||null,banner:p.banner||null,online:presence.has(row.id)};
}
function requireAuth(req,res,next){ if(!req.session.userId) return res.status(401).json({error:'Not authenticated'}); next(); }
function getUser(userId){return db.prepare('SELECT * FROM users WHERE id=?').get(userId);}
function conversationAllowed(userId,c){
  if(c.type==='dm') return c.user_a===userId || c.user_b===userId;
  return !!db.prepare('SELECT 1 FROM group_members WHERE group_id=? AND user_id=?').get(c.group_id,userId);
}
function userState(userId){
  const row=getUser(userId); if(!row) return null;
  const profile=json(row.profile_json,defaultProfile(userId));
  const settings=json(row.settings_json,defaultSettings());
  const friends=db.prepare('SELECT friend_id FROM friendships WHERE user_id=?').all(userId).map(x=>x.friend_id);
  const requests=db.prepare("SELECT from_user FROM friend_requests WHERE to_user=? AND status='pending'").all(userId).map(x=>x.from_user);
  const sentRequests=db.prepare("SELECT to_user FROM friend_requests WHERE from_user=? AND status='pending'").all(userId).map(x=>x.to_user);
  const joinedGroups=db.prepare('SELECT group_id FROM group_members WHERE user_id=?').all(userId).map(x=>x.group_id);
  return {profile,settings,friends,requests,sentRequests,joinedGroups,lastConversation:''};
}
function conversationShape(c){
  const rows=db.prepare(`SELECT m.sender_id,m.body,m.created_at,u.profile_json FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.conversation_id=? ORDER BY m.created_at,m.id`).all(c.id);
  return {id:c.type==='dm'?(c.user_a==='edwin'?c.user_b:c.user_a):c.group_id,type:c.type,user:c.type==='dm'?(c.user_a==='edwin'?c.user_b:c.user_a):undefined,name:c.type==='group'?GROUPS.find(g=>g.id===c.group_id)?.name:undefined,messages:rows.map(r=>[r.sender_id,r.body,new Date(r.created_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})])};
}
function bootstrap(userId){
  const row=getUser(userId); const state=userState(userId);
  const users=db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser);
  const convs=db.prepare('SELECT * FROM conversations ORDER BY created_at').all().filter(c=>conversationAllowed(userId,c)).map(c=>conversationShapeForUser(c,userId));
  return {user:{id:row.id,email:row.email},state,users,groups:GROUPS,conversations:convs};
}
function conversationShapeForUser(c,userId){
  const rows=db.prepare(`SELECT m.sender_id,m.body,m.created_at FROM messages m WHERE m.conversation_id=? ORDER BY m.created_at,m.id`).all(c.id);
  return {id:c.type==='dm'?(c.user_a===userId?c.user_b:c.user_a):c.group_id,type:c.type,user:c.type==='dm'?(c.user_a===userId?c.user_b:c.user_a):undefined,name:c.type==='group'?GROUPS.find(g=>g.id===c.group_id)?.name:undefined,messages:rows.map(r=>[r.sender_id,r.body,new Date(r.created_at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})])};
}
function dmConversation(a,b){
  const aa=[a,b].sort()[0],bb=[a,b].sort()[1];
  let c=db.prepare('SELECT * FROM conversations WHERE type="dm" AND user_a=? AND user_b=?').get(aa,bb);
  if(!c){const cid=`dm_${pairId(a,b)}`;db.prepare('INSERT INTO conversations(id,type,user_a,user_b) VALUES(?,?,?,?)').run(cid,'dm',aa,bb);c=db.prepare('SELECT * FROM conversations WHERE id=?').get(cid);}
  return c;
}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'nova',database:'sqlite',realtime:true}));
app.get('/api/auth/me',(req,res)=>{if(!req.session.userId)return res.json({authenticated:false});const u=getUser(req.session.userId);if(!u)return res.json({authenticated:false});res.json({authenticated:true,user:{id:u.id,email:u.email},state:userState(u.id)});});
app.post('/api/auth/signup',(req,res)=>{
  const name=String(req.body?.name||'').trim(), email=String(req.body?.email||'').trim().toLowerCase(), password=String(req.body?.password||''), handle=String(req.body?.handle||name).trim().toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,24);
  if(!name||!email||!handle)return res.status(400).json({error:'Name, email, and handle are required.'});
  if(password.length<6)return res.status(400).json({error:'Password must be at least 6 characters.'});
  if(db.prepare('SELECT id FROM users WHERE email=?').get(email))return res.status(409).json({error:'That email is already registered.'});
  if(db.prepare("SELECT id FROM users WHERE json_extract(profile_json,'$.handle')=?").get(handle))return res.status(409).json({error:'That handle is already taken.'});
  const uid=id('u'); const p={name,handle,bio:'New to Nova ✦',tags:['New here'],accent:'#8b5cf6',avatar:null,banner:null};
  db.prepare('INSERT INTO users(id,email,password_hash,profile_json,settings_json) VALUES(?,?,?,?,?)').run(uid,email,bcrypt.hashSync(password,10),JSON.stringify(p),JSON.stringify(defaultSettings()));
  req.session.userId=uid;presence.set(uid,new Set());res.json({authenticated:true,user:{id:uid,email},state:userState(uid),users:db.prepare('SELECT * FROM users').all().map(publicUser),groups:GROUPS,conversations:[]});
});
app.post('/api/auth/login',(req,res)=>{const email=String(req.body?.email||'').trim().toLowerCase(), row=db.prepare('SELECT * FROM users WHERE email=?').get(email);if(!row||!bcrypt.compareSync(String(req.body?.password||''),row.password_hash))return res.status(401).json({error:'Incorrect email or password.'});req.session.userId=row.id;res.json({authenticated:true,user:{id:row.id,email:row.email},state:userState(row.id)});});
app.post('/api/auth/logout',(req,res)=>{const uid=req.session.userId;presence.delete(uid);req.session.destroy(()=>res.json({ok:true}));});
app.get('/api/bootstrap',requireAuth,(req,res)=>res.json(bootstrap(req.session.userId)));
app.get('/api/users',requireAuth,(req,res)=>res.json(db.prepare('SELECT * FROM users ORDER BY created_at').all().map(publicUser)));
app.get('/api/state',requireAuth,(req,res)=>res.json(userState(req.session.userId)));
app.put('/api/state',requireAuth,(req,res)=>{
  const b=req.body||{}; const u=getUser(req.session.userId); const profile={...(userState(req.session.userId)?.profile||{}),...(b.profile||{})}; const settings={...(userState(req.session.userId)?.settings||{}),...(b.settings||{})};
  db.prepare('UPDATE users SET profile_json=?,settings_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(profile),JSON.stringify(settings),u.id);
  if(Array.isArray(b.joinedGroups)){const tx=db.transaction(()=>{db.prepare('DELETE FROM group_members WHERE user_id=?').run(u.id);const ins=db.prepare('INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES(?,?)');for(const g of b.joinedGroups)if(GROUPS.some(x=>x.id===g))ins.run(g,u.id)});tx();}
  res.json({ok:true});
});
app.put('/api/profile',requireAuth,(req,res)=>{const u=getUser(req.session.userId);const current=userState(u.id).profile;const p={...current,...req.body};p.handle=String(p.handle||current.handle).replace(/^@/,'').toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,24);const taken=db.prepare("SELECT id FROM users WHERE json_extract(profile_json,'$.handle')=? AND id<>?").get(p.handle,u.id);if(taken)return res.status(409).json({error:'That handle is already taken.'});db.prepare('UPDATE users SET profile_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(p),u.id);broadcastToUser(u.id,{type:'profile_updated',user:publicUser(getUser(u.id))});res.json({profile:p});});
app.put('/api/settings',requireAuth,(req,res)=>{const u=getUser(req.session.userId);const s={...userState(u.id).settings,...req.body};db.prepare('UPDATE users SET settings_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(JSON.stringify(s),u.id);res.json({settings:s});});
app.get('/api/friends/requests',requireAuth,(req,res)=>res.json({requests:db.prepare("SELECT id,from_user,to_user,created_at FROM friend_requests WHERE to_user=? AND status='pending' ORDER BY created_at").all(req.session.userId)}));
app.post('/api/friends/request',requireAuth,(req,res)=>{const from=req.session.userId,to=String(req.body?.userId||'');if(!getUser(to)||to===from)return res.status(400).json({error:'Invalid user.'});if(db.prepare('SELECT 1 FROM friendships WHERE user_id=? AND friend_id=?').get(from,to))return res.status(409).json({error:'Already friends.'});const reverse=db.prepare("SELECT id FROM friend_requests WHERE from_user=? AND to_user=? AND status='pending'").get(to,from);if(reverse){acceptFriend(from,to);return res.json({ok:true,status:'friends'});}try{db.prepare('INSERT INTO friend_requests(id,from_user,to_user,status) VALUES(?,?,?,?)').run(id('req'),from,to,'pending');broadcastToUser(to,{type:'friend_request',from:publicUser(getUser(from))});res.json({ok:true,status:'pending'});}catch{res.status(409).json({error:'Friend request already pending.'});}});
function acceptFriend(a,b){const tx=db.transaction(()=>{db.prepare('UPDATE friend_requests SET status="accepted",updated_at=CURRENT_TIMESTAMP WHERE from_user=? AND to_user=?').run(b,a);db.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id) VALUES(?,?)').run(a,b);db.prepare('INSERT OR IGNORE INTO friendships(user_id,friend_id) VALUES(?,?)').run(b,a);});tx();}
app.post('/api/friends/request/:id/accept',requireAuth,(req,res)=>{const r=db.prepare("SELECT * FROM friend_requests WHERE id=? AND to_user=? AND status='pending'").get(req.params.id,req.session.userId);if(!r)return res.status(404).json({error:'Request not found.'});acceptFriend(r.from_user,req.session.userId);broadcastToUser(r.from_user,{type:'friend_request_accepted',user:publicUser(getUser(req.session.userId))});res.json({ok:true});});
app.post('/api/friends/request/:id/decline',requireAuth,(req,res)=>{const r=db.prepare("SELECT * FROM friend_requests WHERE id=? AND to_user=? AND status='pending'").get(req.params.id,req.session.userId);if(!r)return res.status(404).json({error:'Request not found.'});db.prepare('UPDATE friend_requests SET status="declined",updated_at=CURRENT_TIMESTAMP WHERE id=?').run(r.id);res.json({ok:true});});
app.post('/api/dms/:userId',requireAuth,(req,res)=>{const other=getUser(req.params.userId);if(!other)return res.status(404).json({error:'User not found.'});const c=dmConversation(req.session.userId,other.id);res.json({conversation:conversationShapeForUser(c,req.session.userId)});});
app.post('/api/messages',requireAuth,(req,res)=>{const conversationId=String(req.body?.conversationId||''), body=String(req.body?.body||'').trim();const c=db.prepare('SELECT * FROM conversations WHERE id=?').get(conversationId);if(!c||!body||body.length>4000||!conversationAllowed(req.session.userId,c))return res.status(400).json({error:'Invalid message.'});const m={id:id('msg'),conversationId,senderId:req.session.userId,body,createdAt:new Date().toISOString()};db.prepare('INSERT INTO messages(id,conversation_id,sender_id,body,created_at) VALUES(?,?,?,?,?)').run(m.id,m.conversationId,m.senderId,m.body,m.createdAt);const payload={type:'message',message:m,conversationId};const targets=c.type==='dm'?[c.user_a,c.user_b]:db.prepare('SELECT user_id FROM group_members WHERE group_id=?').all(c.group_id).map(x=>x.user_id);targets.forEach(t=>broadcastToUser(t,payload));res.json({message:m});});
app.post('/api/groups/:groupId/join',requireAuth,(req,res)=>{const g=GROUPS.find(x=>x.id===req.params.groupId);if(!g)return res.status(404).json({error:'Group not found.'});db.prepare('INSERT OR IGNORE INTO group_members(group_id,user_id) VALUES(?,?)').run(g.id,req.session.userId);res.json({ok:true});});
app.delete('/api/groups/:groupId/join',requireAuth,(req,res)=>{db.prepare('DELETE FROM group_members WHERE group_id=? AND user_id=?').run(req.params.groupId,req.session.userId);res.json({ok:true});});

app.use(express.static(__dirname));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));
const wss=new WebSocketServer({noServer:true});
server.on('upgrade',(req,socket,head)=>{
  if(!req.url?.startsWith('/ws')) return socket.destroy();
  const res = { getHeader(){}, setHeader(){}, removeHeader(){}, end(){}, writeHead(){}, headersSent:false };
  sessionMiddleware(req, res, ()=>{
    const uid=req.session?.userId;
    if(!uid || !getUser(uid)){socket.write('HTTP/1.1 401 Unauthorized\\r\\n\\r\\n');socket.destroy();return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req,uid));
  });
});
function broadcastToUser(uid,payload){const set=presence.get(uid);if(!set)return;for(const ws of set){if(ws.readyState===1)ws.send(JSON.stringify(payload));}}
wss.on('connection',(ws,req,uid)=>{
  if(!presence.has(uid))presence.set(uid,new Set());presence.get(uid).add(ws);broadcastPresence();
  ws.on('close',()=>{presence.get(uid)?.delete(ws);if(!presence.get(uid)?.size)presence.delete(uid);broadcastPresence();});
  ws.on('message',raw=>{try{const m=JSON.parse(raw);if(m.type==='ping')ws.send(JSON.stringify({type:'pong'}));}catch{}});
});
function broadcastPresence(){const online=[...presence.keys()];for(const uid of presence.keys())broadcastToUser(uid,{type:'presence',online});}

server.listen(PORT,()=>console.log(`Nova running on http://localhost:${PORT}`));
