let pc, dc, key, init = false;
const cfg = {iceServers:[{urls:'stun:stun.l.google.com:19302'}]};

// Short ID refs
const $ = id => document.getElementById(id);
const s = id => { $('s').classList.toggle('h'); $(id).classList.toggle('h'); };
const msg = (f,t) => {
  const d = document.createElement('div');
  d.className = `msg ${f==='You'?'sent':'received'}`;
  d.textContent = t;
  $('m').appendChild(d);
  $('m').scrollTop = $('m').scrollHeight;
};

// Tiny compress/decompress
const zip = s => btoa(String.fromCharCode(...new Uint8Array(pako.deflate(s,{to:'string'}))));
const unzip = b => pako.inflate(Uint8Array.from(atob(b),c=>c.charCodeAt(0)),{to:'string'});

// Crypto
const gen = () => crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},1,['deriveKey']);
const der = (a,b) => crypto.subtle.deriveKey({name:'ECDH',public:b},a,{name:'AES-GCM',length:256},0,['encrypt','decrypt']);
const enc = async (k,t) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const e = await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(t));
  const a = new Uint8Array(12 + e.byteLength);
  a.set(iv); a.set(new Uint8Array(e),12);
  return btoa(String.fromCharCode(...a));
};
const dec = async (k,b) => {
  const a = Uint8Array.from(atob(b),c=>c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:a.slice(0,12)},k,a.slice(12)));
};
const exp = k => crypto.subtle.exportKey('spki',k).then(e=>btoa(String.fromCharCode(...new Uint8Array(e))));
const imp = b => crypto.subtle.importKey('spki',Uint8Array.from(atob(b),c=>c.charCodeAt(0)),{name:'ECDH',namedCurve:'P-256'},1,[]);

// Create Room
$('c').onclick = async () => {
  init = true;
  const kp = await gen();
  const pub = await exp(kp.publicKey);
  pc = new RTCPeerConnection(cfg);
  dc = pc.createDataChannel('c');
  setupDC();
  pc.onicecandidate = e => !e.candidate && prompt('Share:', zip(JSON.stringify({o:pc.localDescription,p:pub})));
  await pc.setLocalDescription(await pc.createOffer());
  s('chat');
};

// Join Room
$('n').onclick = async () => {
  const raw = unzip($('j').value);
  const d = JSON.parse(raw);
  const kp = await gen();
  const pPub = await imp(d.p);
  key = await der(kp.privateKey, pPub);
  pc = new RTCPeerConnection(cfg);
  pc.ondatachannel = e => {dc=e.channel;setupDC();}
  await pc.setRemoteDescription(d.o);
  await pc.setLocalDescription(await pc.createAnswer());
  pc.onicecandidate = e => !e.candidate && prompt('Send back:', zip(JSON.stringify({a:pc.localDescription,p:await exp(kp.publicKey)})));
  s('chat');
};

// Paste answer
window.onpaste = async e => {
  if (!init || !pc) return;
  try {
    const d = JSON.parse(unzip((e.clipboardData||window.clipboardData).getData('text')));
    if (d.a) {
      await pc.setRemoteDescription(d.a);
      key = await der((await gen()).privateKey, await imp(d.p));
      msg('System','Connected');
    }
  } catch{}
};

// Send
$('send').onclick = async () => {
  const t = $('i').value.trim();
  if (!t || !dc || dc.readyState!=='open') return;
  dc.send(await enc(key,t));
  msg('You',t);
  $('i').value='';
};

// DC
function setupDC() {
  dc.onopen = () => !init && msg('System','Connected');
  dc.onmessage = async e => msg('Partner', await dec(key,e.data));
}
