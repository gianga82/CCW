import React, { useState, useEffect, useRef, useCallback } from 'react';
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

const LS_SESSIONS = 'ccw_sessions';

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(LS_SESSIONS) || '[]'); } catch { return []; }
}

export default function App() {
  const [models, setModels] = useState([]);
  const [byOwner, setByOwner] = useState({});
  const [model, setModel] = useState('');
  const [sessions, setSessions] = useState(loadSessions);
  const [active, setActive] = useState(null); // { sessionId, title }
  const [messages, setMessages] = useState([]); // [{role, text, thinking, tools:[], status}]
  const [running, setRunning] = useState(false);
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState({ effort: '', maxTurns: 100, markdown: true });
  const abortRef = useRef(null);
  const endRef = useRef(null);

  useEffect(() => {
    fetch('/api/models').then(r => r.json()).then(d => {
      const m = d.data || [];
      setModels(m);
      setByOwner(d.byOwner || {});
      const saved = localStorage.getItem('ccw_model');
      const pref = ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-pro'];
      const chosen = saved && m.some(x => x.id === saved) ? saved
        : pref.find(p => m.some(x => x.id === p)) || (m[0]?.id || '');
      setModel(chosen);
    }).catch(() => setError('Backend nicht erreichbar'));
  }, []);

  useEffect(() => { localStorage.setItem('ccw_model', model); }, [model]);
  useEffect(() => { localStorage.setItem('ccw_settings', JSON.stringify(settings)); }, [settings]);
  useEffect(() => {
    try { const s = JSON.parse(localStorage.getItem('ccw_settings') || 'null'); if (s) setSettings({ ...settings, ...s }); } catch {}
  }, []);
  useEffect(() => { localStorage.setItem(LS_SESSIONS, JSON.stringify(sessions)); }, [sessions]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const saveSession = useCallback((sessionId, title) => {
    setSessions(prev => {
      if (prev.some(s => s.sessionId === sessionId)) return prev;
      return [{ sessionId, title: title || 'Neue Session', updatedAt: Date.now() }, ...prev].slice(0, 50);
    });
    setActive(prev => prev?.sessionId === sessionId ? prev : { sessionId, title: title || 'Neue Session' });
  }, []);

  const newChat = () => {
    setActive(null);
    setMessages([]);
    setError('');
  };

  const deleteSession = async (s) => {
    if (!confirm(`Session „${s.title}“ wirklich löschen?`)) return;
    try { await fetch('/api/session/' + s.sessionId, { method: 'DELETE' }); } catch {}
    setSessions(prev => prev.filter(x => x.sessionId !== s.sessionId));
    if (active?.sessionId === s.sessionId) newChat();
  };

  const renameSession = (s) => {
    const name = prompt('Neuer Name für die Session:', s.title);
    if (name && name.trim()) {
      setSessions(prev => prev.map(x => x.sessionId === s.sessionId ? { ...x, title: name.trim() } : x));
      setActive(prev => prev?.sessionId === s.sessionId ? { ...prev, title: name.trim() } : prev);
    }
  };

  const selectSession = (s) => {
    setActive(s);
    setMessages([{ role: 'assistant', text: `Session „${s.title}“ fortgesetzt.`, thinking: '', tools: [], status: 'done' }]);
    setError('');
  };

  const send = async () => {
    const msg = input.trim();
    if (!msg || running) return;
    setInput('');
    setError('');
    const sessionId = active?.sessionId || null;
    const userMsg = { role: 'user', text: msg, thinking: '', tools: [], status: 'done' };
    const assistantMsg = { role: 'assistant', text: '', thinking: '', tools: [], status: 'running' };
    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setRunning(true);

    const idxRef = { a: null };
    const setLast = (fn) => setMessages(prev => {
      const arr = [...prev];
      const i = arr.length - 1;
      arr[i] = fn(arr[i]);
      return arr;
    });

    let sid = sessionId;
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, model, sessionId: sid, effort: settings.effort || undefined, maxTurns: settings.maxTurns || undefined }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(t || ('HTTP ' + res.status));
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let curEvent = '';
      let result = null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).replace(/\r$/, '');
          buf = buf.slice(idx + 1);
          if (line.startsWith('event: ')) curEvent = line.slice(7).trim();
          else if (line.startsWith('data: ')) {
            const payload = JSON.parse(line.slice(6));
            handleEvent(curEvent, payload, { setLast, saveSession, setError, setSessions, setActive, setRunning, setMessages, sid: () => sid });
            curEvent = '';
          }
        }
      }
      if (result && result.sessionId && result.sessionId !== sid) {
        sid = result.sessionId;
        setSessions(prev => prev.map(s => s.sessionId === sid ? { ...s, updatedAt: Date.now() } : s));
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError('Fehler: ' + e.message);
    } finally {
      setRunning(false);
      abortRef.current = null;
      setLast(m => ({ ...m, status: m.status === 'running' ? 'done' : m.status }));
    }
  };

  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="layout">
      <div className={'backdrop' + (menuOpen ? ' show' : '')} onClick={() => setMenuOpen(false)} />
      <Sidebar sessions={sessions} active={active} onNew={() => { newChat(); setMenuOpen(false); }} onSelect={(s) => { selectSession(s); setMenuOpen(false); }} open={menuOpen} onDelete={deleteSession} onRename={renameSession} />
      <main className="chat">
        <header className="topbar">
          <button className="menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menü">☰</button>
          <div className="brand">Command Code <span className="brand-sub">Web</span></div>
          <div className="topbar-right">
            <select value={model} onChange={e => setModel(e.target.value)} className="model-select" title="Modell wählen">
              {Object.entries(byOwner).map(([owner, list]) => (
                <optgroup key={owner} label={owner}>
                  {list.map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                </optgroup>
              ))}
            </select>
            <button className="refresh-btn" onClick={() => location.reload()} title="Neu laden">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>
            </button>
            <button className={'refresh-btn' + (settingsOpen ? ' active' : '')} onClick={() => setSettingsOpen(!settingsOpen)} title="Einstellungen">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </header>
        {settingsOpen && (
          <div className="settings-panel">
            <h3>Einstellungen</h3>
            <label>Reasoning-Effort
              <select value={settings.effort} onChange={e => setSettings({ ...settings, effort: e.target.value })}>
                <option value="">Standard (Auto)</option>
                <option value="low">Niedrig (schnell)</option>
                <option value="medium">Mittel</option>
                <option value="high">Hoch (gründlich)</option>
              </select>
            </label>
            <label>Max. Antwort-Umdrehungen
              <input type="number" min="1" max="200" value={settings.maxTurns}
                onChange={e => setSettings({ ...settings, maxTurns: Number(e.target.value) || 100 })} />
            </label>
            <label className="switch-row">Markdown-Rendering
              <input type="checkbox" className="toggle" checked={settings.markdown}
                onChange={e => setSettings({ ...settings, markdown: e.target.checked })} />
            </label>
            <p className="hint">Einstellungen gelten ab der nächsten Nachricht.</p>
          </div>
        )}
        <div className="messages">
          {messages.length === 0 && (
            <div className="welcome">
              <h2>Command Code Web</h2>
              <p>Chatte über die Command-Code-CLI mit deinen Go-Plan-Modellen. Tools werden live angezeigt.</p>
            </div>
          )}
          {messages.map((m, i) => <Message key={i} m={m} markdown={settings.markdown} />)}
          <div ref={endRef} />
        </div>
        {error && <div className="error">{error}</div>}
        <footer className="composer">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Nachricht an Command Code … (Enter senden, Shift+Enter neue Zeile)"
            disabled={running}
            rows={2}
          />
          <button onClick={running ? () => abortRef.current?.abort() : send} disabled={running ? false : !input.trim()}>
            {running ? '■ Stop' : 'Senden'}
          </button>
        </footer>
      </main>
    </div>
  );
}

function Sidebar({ sessions, active, onNew, onSelect, open, onDelete, onRename }) {
  return (
    <aside className={'sidebar' + (open ? ' open' : '')}>
      <button className="new-btn" onClick={onNew}>+ Neue Session</button>
      <div className="sessions">
        {sessions.length === 0 && <p className="hint">Noch keine Sessions</p>}
        {sessions.map(s => (
          <div key={s.sessionId} className={'session-row' + (active?.sessionId === s.sessionId ? ' active' : '')}>
            <button className="session" onClick={() => onSelect(s)} title={s.sessionId}>
              {s.title}
            </button>
            <div className="session-actions">
              <button className="mini-btn" onClick={() => onRename(s)} title="Umbenennen">✎</button>
              <button className="mini-btn del" onClick={() => onDelete(s)} title="Löschen">🗑</button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function handleEvent(ev, payload, ctx) {
  const { setLast, saveSession, setError, setRunning, sid } = ctx;
  switch (ev) {
    case 'started':
      if (payload.sessionId) {
        saveSession(payload.sessionId, 'Session');
        sid = payload.sessionId;
      }
      break;
    case 'event': {
      const t = payload.type;
      if (t === 'run_start') {
        saveSession(payload.sessionId, 'Session');
      } else if (t === 'thinking_start') {
        setLast(m => ({ ...m, thinking: (m.thinking ? m.thinking + '\n' : '') + '…' }));
      } else if (t === 'thinking_delta') {
        setLast(m => ({ ...m, thinking: m.thinking + (payload.delta ?? payload.text ?? '') }));
      } else if (t === 'text_delta') {
        setLast(m => ({ ...m, text: m.text + (payload.delta ?? payload.text ?? '') }));
      } else if (t === 'tool_queued') {
        setLast(m => ({ ...m, tools: [...m.tools, { id: payload.toolCallId || m.tools.length, name: payload.toolName, input: JSON.stringify(payload.input || {}), status: 'queued', result: '' }] }));
      } else if (t === 'tool_running') {
        setLast(m => ({ ...m, tools: m.tools.map(t => t.id === payload.toolCallId ? { ...t, status: 'running' } : t) }));
      } else if (t === 'tool_completed') {
        setLast(m => ({ ...m, tools: m.tools.map(t => t.id === payload.toolCallId ? { ...t, status: 'done', result: JSON.stringify(payload.result ?? '').slice(0, 2000) } : t) }));
      } else if (t === 'run_error') {
        const e = payload.error || {};
        setError('Modell-Fehler: ' + (e.message || JSON.stringify(e)).slice(0, 300));
        setRunning(false);
      } else if (t === 'run_end') {
        const r = payload.result || payload;
        const ns = r.nextState || {};
        if (ns.sessionId) saveSession(ns.sessionId, (r.finalText || 'Session').slice(0, 60));
      }
      break;
    }
    case 'result':
      if (payload.sessionId) saveSession(payload.sessionId, (payload.finalText || 'Session').slice(0, 60));
      break;
    case 'error':
      setError(payload.message || 'Unbekannter Fehler');
      setRunning(false);
      break;
    case 'done':
      break;
  }
}

function CopyBtn({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button className="copy-btn" onClick={async () => {
      try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {}
    }} title="Kopieren">
      {done ? '✓' : '⧉'}
    </button>
  );
}

function Message({ m, markdown }) {
  return (
    <div className={'msg ' + m.role}>
      <div className="who">
        {m.role === 'user' ? 'Du' : 'Command Code'}
        {m.role === 'assistant' && m.text && <CopyBtn text={m.text} />}
      </div>
      {m.text && (
        <div className={'text' + (markdown && m.role === 'assistant' ? ' md' : '')}>
          {markdown && m.role === 'assistant'
            ? <div dangerouslySetInnerHTML={{ __html: md.render(m.text) }} />
            : m.text}
        </div>
      )}
      {m.thinking && m.role === 'assistant' && (
        <details className="thinking">
          <summary>Gedanken</summary>
          <pre>{m.thinking}</pre>
        </details>
      )}
      {m.tools.length > 0 && (
        <div className="tools">
          {m.tools.map(t => (
            <div key={t.id} className={'tool ' + t.status}>
              <div className="tool-head">
                <span className="tool-name">{t.name}</span>
                <span className="tool-status">{t.status}</span>
              </div>
              <pre className="tool-input">{t.input}</pre>
              {t.result && <pre className="tool-result">{t.result}</pre>}
            </div>
          ))}
        </div>
      )}
      {m.status === 'running' && <div className="dots"><span /><span /><span /></div>}
    </div>
  );
}
