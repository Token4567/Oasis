let pc, dc, sharedKey;
const cfg = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const $ = id => document.getElementById(id);

// Crypto
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

// Create Room
$('#create').onclick = async () => {
  const roomId = Math.random().toString(36).substr(2, 9);
  const kp = await gen();
  const pub = await exp(kp.publicKey);

  // Save to URL
  const url = new URL(location);
  url.searchParams.set('room', roomId);
  url.searchParams.set('pub', pub);
  history.replaceState(null, '', url);

  // Show link
  $('#roomLink').value = url.toString();
  $('#linkArea').classList.remove('hidden');
  $('#create').classList.add('hidden');

  // Setup WebRTC
  pc = new RTCPeerConnection(cfg);
  dc = pc.createDataChannel('chat');
  setupDC();

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  pc.onicecandidate = async () => {
    if (pc.localDescription) {
      const sdp = pc.localDescription.sdp;
      url.searchParams.set('sdp', btoa(sdp));
      $('#roomLink').value = url.toString();
    }
  };

  $('#setup').classList.add('hidden');
  $('#chat').classList.remove('hidden');
};

// Join from URL
window.onload = async () => {
  const params = new URLSearchParams(location.search);
  const room = params.get('room');
  const pubB64 = params.get('pub');
  const sdpB64 = params.get('sdp');

  if (room && pubB64 && sdpB64) {
    const kp = await gen();
    const partnerPub = await imp(pubB64);
    sharedKey = await der(kp.privateKey, partnerPub);

    pc = new RTCPeerConnection(cfg);
    pc.ondatachannel = e => { dc = e.channel; setupDC(); };

    await pc.setRemoteDescription({ type: 'offer', sdp: atob(sdpB64) });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    $('#setup').classList.add('hidden');
    $('#chat').classList.remove('hidden');
  }
};

// Copy button
$('#copyBtn').onclick = () => {
  $('#roomLink').select();
  document.execCommand('copy');
  $('#copyBtn').textContent = 'Copied!';
  setTimeout(() => $('#copyBtn').textContent = 'Copy', 2000);
};

// Send
$('#sendBtn').onclick = async () => {
  const t = $('#msgInput').value.trim();
  if (!t || !dc || dc.readyState !== 'open') return;
  dc.send(await enc(sharedKey, t));
  addMsg('You', t);
  $('#msgInput').value = '';
};

function addMsg(sender, text) {
  const div = document.createElement('div');
  div.className = `message ${sender === 'You' ? 'sent' : 'received'}`;
  div.textContent = text;
  $('#messages').appendChild(div);
  $('#messages').scrollTop = $('#messages').scrollHeight;
}

function setupDC() {
  dc.onopen = () => addMsg('System', 'Connected & encrypted');
  dc.onmessage = async e => addMsg('Partner', await dec(sharedKey, e.data));
}
