const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 4100;
const API_KEY = process.env.CC_API_KEY || '';
if (!API_KEY) {
  console.error('FEHLER: CC_API_KEY nicht gesetzt - Abbruch');
  process.exit(1);
}
const NODE_BIN = process.env.CC_NODE || '/root/projekte/node-v22.17.0-linux-x64/bin/node';
const CMD_BIN = process.env.CC_CMD || '/usr/local/bin/cmd';
const WORKDIR = process.env.CC_WORKDIR || '/root/dashboard';
const AUTH_USER = process.env.CC_AUTH_USER || '';
const AUTH_PASS = process.env.CC_AUTH_PASS || '';
if (!AUTH_USER || !AUTH_PASS) {
  console.error('FEHLER: CC_AUTH_USER/CC_AUTH_PASS nicht gesetzt - Abbruch');
  process.exit(1);
}
const MAX_RUN_SECONDS = 600;

const MODELS = JSON.parse(fs.readFileSync(path.join(__dirname, 'models.json'), 'utf8')).data;

// ---------- Basic Auth ----------
function basicAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const b64 = h.replace(/^Basic /, '');
  const [u, p] = Buffer.from(b64, 'base64').toString().split(':');
  if (u === AUTH_USER && p === AUTH_PASS) return next();
  res.set('WWW-Authenticate', 'Basic realm="Command Code Web"');
  return res.status(401).send('Unauthorized');
}
app.use('/api', basicAuth);

// ---------- SSE-Helfer ----------
function sse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// ---------- Modell-Liste ----------
app.get('/api/models', (req, res) => {
  const byOwner = {};
  for (const m of MODELS) {
    const owner = m.owned_by === 'command-code' ? 'command-code' : m.id.split('/')[0];
    (byOwner[owner] = byOwner[owner] || []).push(m);
  }
  res.json({ data: MODELS, byOwner });
});

// ---------- Chat (SSE) ----------
app.post('/api/chat', (req, res) => {
  const { message, model, sessionId, workdir, files } = req.body || {};
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }
  const cwd = workdir || WORKDIR;

  const args = ['-p', message, '--output-format', 'json', '--yolo', '--no-auto-update', '--skip-onboarding'];
  if (model) args.push('--model', model);
  if (sessionId) args.push('--resume', sessionId);


  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sse(res, 'started', { sessionId: sessionId || null });

  let killed = false;
  const child = spawn(CMD_BIN, args, {
    cwd,
    env: { ...process.env, COMMAND_CODE_API_KEY: API_KEY, PATH: `${path.dirname(NODE_BIN)}:${process.env.PATH}` },
  });

  const killTimer = setTimeout(() => {
    killed = true;
    child.kill('SIGKILL');
    sse(res, 'error', { message: `Timeout nach ${MAX_RUN_SECONDS}s` });
    res.end();
  }, MAX_RUN_SECONDS * 1000);

  let stdoutBuf = '';
  child.stdout.on('data', (chunk) => {
    stdoutBuf += chunk.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx).trim();
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        const ev = obj.event || obj;
        if (obj.type === 'result') {
          sse(res, 'result', ev);
          continue;
        }
        sse(res, 'event', ev);
      } catch (e) { /* nicht-JSON Zeilen ignorieren */ }
    }
  });

  child.stderr.on('data', (chunk) => {
    const txt = chunk.toString();
    if (/Not authenticated|Login failed|plan doesn't include API/.test(txt)) {
      sse(res, 'error', { message: txt.trim() });
    }
  });

  child.on('close', (code) => {
    clearTimeout(killTimer);
    sse(res, 'done', { code });
    res.end();
  });

  res.on('close', () => {
    if (!res.writableEnded && !killed) {
      child.kill('SIGKILL');
    }
  });
});

// ---------- Statisches Frontend ----------
const WEB_DIST = path.join(__dirname, 'web', 'dist');
app.use(express.static(WEB_DIST));
app.get('*', (req, res) => {
  res.sendFile(path.join(WEB_DIST, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Command Code Web auf http://0.0.0.0:${PORT}`);
});
