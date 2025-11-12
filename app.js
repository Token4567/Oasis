let pc, dc, sharedKey;
const cfg = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const $ = id => document.getElementById(id);

const gen = () => crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveKey']);
const der = (a,b) => crypto.subtle.deriveKey({name:'ECDH',public:b},a,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
const enc = async (k,t) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const e = await crypto.subtle.encrypt({name:'AES-GCM',iv},k,new TextEncoder().encode(t));
  const a = new Uint8Array(12+e.byteLength); a.set(iv); a.set(new Uint8Array(e),12);
  return btoa(String.fromCharCode(...a));
};
const dec = async (k,b) => {
  const a = Uint8Array.from(atob(b),c=>c.charCodeAt(0));
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:a.slice(0,12)},k,a.slice(12)));
};
const exp = k => crypto.subtle.exportKey('spki',k).then(e=>btoa(String.fromCharCode(...new Uint8Array(e))));
const imp = b => crypto.subtle.importKey('spki',Uint8Array.from(atob(b),c=>c.charCodeAt(0)),{name:'ECDH',namedCurve:'P-256'},true,[]);

function addMsg(s, t) {
  const d = document.createElement('div');
  d.className = `message ${s === 'You' ? 'sent' : 'received'}`;
  d.textContent = t;
  $('#messages').appendChild(d);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

$('#create').onclick = async () => {
  const id = Math.random().toString(36).substr(2, 8);
  const kp = await gen();
  const pub = await exp(kp.publicKey);

  pc = new RTCPeerConnection(cfg);
  dc = pc.createDataChannel('chat');
  setupDC();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const update = () => {
    const u = new URL(location);
    u.searchParams.set('room', id);
    u.searchParams.set('pub', pub);
    if (pc.localDescription?.sdp) u.searchParams.set('sdp', btoa(pc.localDescription.sdp));
    $('#roomLink').value = u.toString();
  };

  pc.onicecandidate = update;
  setInterval(update, 500);
  update();

  $('#linkArea').classList.remove('hidden');
  $('#create').style.display = 'none';
  $('#setup').classList.add('hidden');
  $('#chat').classList.remove('hidden');
};

window.onload = async () => {
  const u = new URL(location);
  const room = u.searchParams.get('room');
  const pub = u.searchParams.get('pub');
  const sdp = u.searchParams.get('sdp');
  if (room && pub && sdp) {
    const kp = await gen();
    const pPub = await imp(pub);
    sharedKey = await der(kp.privateKey, pPub);

    pc = new RTCPeerConnection(cfg);
    pc.ondatachannel = e => { dc = e.channel; setupDC(); };
    await pc.setRemoteDescription({ type: 'offer', sdp: atob(sdp) });
    await pc.setLocalDescription(await pc.createAnswer());

    $('#setup').classList.add('hidden');
    $('#chat').classList.remove('hidden');
  }
};

$('#copyBtn').onclick = () => {
  $('#roomLink').select();
  document.execCommand('copy');
  $('#copyBtn').textContent = 'Copied!';
  setTimeout(() => $('#copyBtn').textContent = 'Copy', 2000);
};

$('#sendBtn').onclick = async () => {
  const t = $('#msgInput').value.trim();
  if (!t || !dc || dc.readyState !== 'open') return;
  dc.send(await enc(sharedKey, t));
  addMsg('You', t);
  $('#msgInput').value = '';
};

function setupDC() {
  dc.onopen = () => addMsg('System', 'Connected & encrypted');
  dc.onmessage = async e => addMsg('Partner', await dec(sharedKey, e.data));
}
