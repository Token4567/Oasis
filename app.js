// app.js – WebRTC + E2EE + SHORT invite codes
let pc, dc, sharedKey, isInitiator = false;
const cfg = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// ---------- Helpers ----------
const $ = id => document.getElementById(id);
const zip = s => btoa(String.fromCharCode(...new Uint8Array(pako.deflate(s,{to:'string'}))));
const unzip = b => pako.inflate(Uint8Array.from(atob(b),c=>c.charCodeAt(0)),{to:'string'});

async function gen() { return crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']); }
async function der(priv, pub) { return crypto.subtle.deriveKey({name:'ECDH',public:pub},priv,{name:'AES-GCM',length:256},false,['encrypt','decrypt']); }
async function enc(key,txt) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const e = await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(txt));
  const a = new Uint8Array(12+e.byteLength); a.set(iv); a.set(new Uint8Array(e),12);
  return btoa(String.fromCharCode(...a));
}
async function dec(key,b64) {
  const a = Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:a.slice(0,12)},key,a.slice(12)));
}
async function exp(k) { return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.exportKey('spki',k)))); }
async function imp(b) { return crypto.subtle.importKey('spki',Uint8Array.from(atob(b),c=>c.charCodeAt(0)),{name:'ECDH',namedCurve:'P-256'},true,[]); }

function add(msg, txt) {
  const d = document.createElement('div');
  d.className = `message ${msg==='You'?'sent':'received'}`;
  d.textContent = txt;
  $('messages').appendChild(d);
  $('messages').scrollTop = $('messages').scrollHeight;
}

// ---------- UI ----------
$('#setup').classList.remove('hidden');
$('#create').onclick = async () => {
  isInitiator = true;
  const kp = await gen();
  const pub = await exp(kp.publicKey);
  pc = new RTCPeerConnection(cfg);
  dc = pc.createDataChannel('chat');
  setupDC();
  pc.onicecandidate = e => !e.candidate && prompt('Share this short code:', zip(JSON.stringify({o:pc.localDescription,p:pub})));
  await pc.setLocalDescription(await pc.createOffer());
  $('#setup').classList.add('hidden'); $('#chat').classList.remove('hidden');
};

$('#join').onclick = async () => {
  const code = $('#joinCode').value.trim();
  if (!code) return alert('Paste a code');
  try {
    const raw = unzip(code);
    const {o, p} = JSON.parse(raw);
    const kp = await gen();
    const partnerPub = await imp(p);
    sharedKey = await der(kp.privateKey, partnerPub);
    pc = new RTCPeerConnection(cfg);
    pc.ondatachannel = e => {dc=e.channel; setupDC();}
    await pc.setRemoteDescription(o);
    await pc.setLocalDescription(await pc.createAnswer());
    pc.onicecandidate = async e => !e.candidate && prompt('Send back this short code:', zip(JSON.stringify({a:pc.localDescription,p:await exp(kp.publicKey)})));
    $('#setup').classList.add('hidden'); $('#chat').classList.remove('hidden');
  } catch { alert('Invalid code'); }
};

window.onpaste = async e => {
  if (!isInitiator || !pc) return;
  try {
    const {a, p} = JSON.parse(unzip((e.clipboardData||window.clipboardData).getData('text')));
    await pc.setRemoteDescription(a);
    const kp = await gen();
    sharedKey = await der(kp.privateKey, await imp(p));
    add('System','Secure connection established');
  } catch {}
};

$('#sendBtn').onclick = async () => {
  const txt = $('#msgInput').value.trim();
  if (!txt || !dc || dc.readyState!=='open') return;
  dc.send(await enc(sharedKey,txt));
  add('You',txt);
  $('#msgInput').value='';
};

function setupDC() {
  dc.onopen = () => !isInitiator && add('System','Secure connection established');
  dc.onmessage = async e => add('Partner', await dec(sharedKey,e.data));
}
