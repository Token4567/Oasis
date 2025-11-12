# Oasis
private-chat/
├─ .gitignore
├─ package.json
├─ server.js
├─ public/
│   ├─ index.html
│   ├─ style.css
│   └─ app.js
└─ README.md
node_modules/
.env
{
  "name": "private-chat",
  "version": "1.0.0",
  "description": "E2EE real-time private text chat",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "author": "You",
  "license": "MIT",
  "dependencies": {
    "express": "^4.19.2",
    "socket.io": "^4.7.5"
  },
  "devDependencies": {
    "nodemon": "^3.1.4"
  }
}
// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// --- Socket.IO logic (only relays encrypted blobs) ---
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a private room (room = sorted pair of socket IDs)
  socket.on('join-room', (partnerId) => {
    const room = [socket.id, partnerId].sort().join('-');
    socket.join(room);
    socket.to(partnerId).emit('partner-joined', socket.id);
  });

  // Forward encrypted message
  socket.on('send-message', ({ to, encrypted }) => {
    const room = [socket.id, to].sort().join('-');
    socket.to(room).emit('receive-message', { from: socket.id, encrypted });
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Private Chat</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <div id="setup">
    <h1>Private Chat</h1>
    <p>Share this link with one person. Messages are end-to-end encrypted.</p>
    <button id="create">Create Room</button>
    <input type="text" id="joinCode" placeholder="Or paste invite code" />
    <button id="join">Join</button>
  </div>

  <div id="chat" class="hidden">
    <div id="messages"></div>
    <div id="inputArea">
      <input type="text" id="msgInput" placeholder="Type a message..." autocomplete="off" />
      <button id="sendBtn">Send</button>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="app.js"></script>
</body>
</html>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: system-ui, sans-serif; background:#f4f4f9; padding:2rem; }
#setup, #chat { max-width:600px; margin:auto; background:white; padding:2rem; border-radius:12px; box-shadow:0 4px 12px rgba(0,0,0,.1); }
#setup h1 { margin-bottom:1rem; }
button { padding:.6rem 1.2rem; margin:0 .5rem; border:none; border-radius:6px; background:#0066ff; color:white; cursor:pointer; }
button:hover { background:#0055cc; }
input { padding:.6rem; width:calc(100% - 1rem); margin:1rem 0; border:1px solid #ccc; border-radius:6px; }
#messages { height:60vh; overflow-y:auto; padding:1rem; border:1px solid #eee; border-radius:6px; margin-bottom:1rem; }
.message { margin:0.5rem 0; padding:.6rem 1rem; border-radius:18px; max-width:80%; }
.sent { background:#0066ff; color:white; align-self:flex-end; margin-left:auto; }
.received { background:#e5e5ea; color:black; }
#inputArea { display:flex; gap:.5rem; }
#msgInput { flex:1; }
.hidden { display:none; }
// app.js
const socket = io();

let myId = null;
let partnerId = null;
let sharedKey = null;   // Derived AES-GCM key

socket.on('connect', () => {
  myId = socket.id;
  console.log('My ID:', myId);
});

// ---------- Crypto Helpers ----------
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
  // Return IV + ciphertext as base64
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

// ---------- UI ----------
const setupDiv = document.getElementById('setup');
const chatDiv = document.getElementById('chat');
const messagesDiv = document.getElementById('messages');
const msgInput = document.getElementById('msgInput');
const sendBtn = document.getElementById('sendBtn');

let myKeyPair = null;

document.getElementById('create').onclick = async () => {
  myKeyPair = await generateKeyPair();
  const pubB64 = await exportPublicKey(myKeyPair.publicKey);
  const code = `${myId}:${pubB64}`;
  prompt('Share this code with your friend:', code);
  setupDiv.classList.add('hidden');
  chatDiv.classList.remove('hidden');
  startListening();
};

document.getElementById('join').onclick = async () => {
  const code = document.getElementById('joinCode').value.trim();
  if (!code) return alert('Paste a code');
  const [partner, pubB64] = code.split(':');
  if (!partner || !pubB64) return alert('Invalid code');

  myKeyPair = await generateKeyPair();
  const partnerPub = await importPublicKey(pubB64);
  sharedKey = await deriveSharedKey(myKeyPair.privateKey, partnerPub);

  partnerId = partner;
  socket.emit('join-room', partnerId);

  const myPubB64 = await exportPublicKey(myKeyPair.publicKey);
  socket.emit('send-message', { to: partnerId, encrypted: myPubB64 }); // send my pub key

  setupDiv.classList.add('hidden');
  chatDiv.classList.remove('hidden');
  startListening();
};

// Export / import public keys as base64
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

// ---------- Socket events ----------
function startListening() {
  socket.on('partner-joined', async (id) => {
    partnerId = id;
    const partnerPub = await importPublicKey(/* will arrive in message */);
    // wait for pub key
  });

  socket.on('receive-message', async ({ from, encrypted }) => {
    if (!sharedKey) {
      // First message is always the public key
      const partnerPub = await importPublicKey(encrypted);
      sharedKey = await deriveSharedKey(myKeyPair.privateKey, partnerPub);
      addMessage('System', '🔒 Secure connection established');
      return;
    }

    try {
      const text = await decryptMessage(sharedKey, encrypted);
      addMessage('Partner', text);
    } catch (e) {
      console.error('Decrypt failed', e);
    }
  });
}

sendBtn.onclick = async () => {
  const text = msgInput.value.trim();
  if (!text || !sharedKey) return;
  const encrypted = await encryptMessage(sharedKey, text);
  socket.emit('send-message', { to: partnerId, encrypted });
  addMessage('You', text);
  msgInput.value = '';
};

function addMessage(sender, text) {
  const div = document.createElement('div');
  div.className = `message ${sender === 'You' ? 'sent' : 'received'}`;
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
