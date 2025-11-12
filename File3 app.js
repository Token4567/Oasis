touch app.js
// app.js – WebRTC + E2EE Private Chat (GitHub Pages Compatible)
let peerConnection = null;
let dataChannel = null;
let sharedKey = null;
let isInitiator = false;

const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

// Crypto: ECDH + AES-GCM
async function generateKeyPair() {
  return await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  );
}

async function deriveSharedKey(myPriv, partnerPub) {
  return await crypto.subtle.deriveKey(
    { name: 'ECDH', public: partnerPub },
    myPriv,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptMessage(key, text) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = encoder.encode(text);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return btoa(String.fromCharCode(...combined));
}

async function decryptMessage(key, b64) {
  const decoder = new TextDecoder();
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return decoder.decode(plaintext);
}

async function exportPublicKey(key) {
  const exported = await crypto.subtle.exportKey('spki', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

async function importPublicKey(b64) {
  const binary = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    'spki',
    binary,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  );
}

// UI Elements
const setupDiv = document.getElementById('setup');
const chatDiv = document.getElementById('chat');
const messagesDiv = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');

let myKeyPair = null;

// --- Create Room ---
document.getElementById('create').onclick = async () => {
  isInitiator = true;
  myKeyPair = await generateKeyPair();
  const pubB64 = await exportPublicKey(myKeyPair.publicKey);

  peerConnection = new RTCPeerConnection(config);
  dataChannel = peerConnection.createDataChannel('chat');
  setupDataChannel();

  peerConnection.onicecandidate = (e) => {
    if (!e.candidate) {
      const offer = peerConnection.localDescription;
      const code = JSON.stringify({ offer, pubKey: pubB64 });
      prompt('Share this code with your friend:', code);
    }
  };

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);

  setupDiv.classList.add('hidden');
  chatDiv.classList.remove('hidden');
};

// --- Join Room ---
document.getElementById('join').onclick = async () => {
  const code = document.getElementById('joinCode').value.trim();
  if (!code) return alert('Paste a code');

  let data;
  try { data = JSON.parse(code); } catch { return alert('Invalid code'); }

  myKeyPair = await generateKeyPair();
  const partnerPub = await importPublicKey(data.pubKey);
  sharedKey = await deriveSharedKey(myKeyPair.privateKey, partnerPub);

  peerConnection = new RTCPeerConnection(config);
  peerConnection.ondatachannel = (event) => {
    dataChannel = event.channel;
    setupDataChannel();
  };

  await peerConnection.setRemoteDescription(data.offer);
  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);

  peerConnection.onicecandidate = async (e) => {
    if (!e.candidate) {
      const myPubB64 = await exportPublicKey(myKeyPair.publicKey);
      const answerCode = JSON.stringify({ answer: peerConnection.localDescription, pubKey: myPubB64 });
      prompt('Send this back to your friend:', answerCode);
    }
  };

  setupDiv.classList.add('hidden');
  chatDiv.classList.remove('hidden');
};

// --- Paste Answer (for initiator) ---
window.addEventListener('paste', async (e) => {
  if (isInitiator && peerConnection) {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    let data;
    try { data = JSON.parse(text); } catch { return; }
    if (data.answer) {
      await peerConnection.setRemoteDescription(data.answer);
      const partnerPub = await importPublicKey(data.pubKey);
      sharedKey = await deriveSharedKey(myKeyPair.privateKey, partnerPub);
      addMessage('System', 'Secure connection established');
    }
  }
});

// --- Data Channel ---
function setupDataChannel() {
  dataChannel.onopen = () => {
    if (!isInitiator) addMessage('System', 'Secure connection established');
  };
  dataChannel.onmessage = async (e) => {
    if (!sharedKey) return;
    try {
      const text = await decryptMessage(sharedKey, e.data);
      addMessage('Partner', text);
    } catch (err) {
      console.error('Decrypt failed:', err);
    }
  };
}

// --- Send Message ---
sendBtn.onclick = async () => {
  const text = msgInput.value.trim();
  if (!text || !dataChannel || dataChannel.readyState !== 'open' || !sharedKey) return;
  const encrypted = await encryptMessage(sharedKey, text);
  dataChannel.send(encrypted);
  addMessage('You', text);
  msgInput.value = '';
};

// --- Add Message ---
function addMessage(sender, text) {
  const div = document.createElement('div');
  div.className = `message ${sender === 'You' ? 'sent' : 'received'}`;
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}