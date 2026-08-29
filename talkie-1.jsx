import React, { useState, useEffect, useRef, useCallback } from "react";

/* ------------------------------------------------------------------ */
/*  Stockage                                                           */
/* ------------------------------------------------------------------ */

const ROSTER = "roster";
const NAME_RE = /^[a-z0-9_-]{2,14}$/;
const MAX_MSGS = 80;
const MAX_SEC = 60;

const threadKey = (a, b) => "thread:" + [a, b].sort().join("__");

async function sget(key, shared = true) {
  try {
    const r = await window.storage.get(key, shared);
    if (!r) return null;
    return JSON.parse(r.value);
  } catch (e) {
    return null;
  }
}

async function sset(key, val, shared = true) {
  try {
    await window.storage.set(key, JSON.stringify(val), shared);
    return true;
  } catch (e) {
    return false;
  }
}

const now = () => Date.now();

function clock(ts) {
  const d = new Date(ts);
  return d.getHours() + ":" + String(d.getMinutes()).padStart(2, "0");
}

function ago(ts) {
  const s = Math.floor((now() - ts) / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return "il y a " + Math.floor(s / 60) + " min";
  if (s < 86400) return "il y a " + Math.floor(s / 3600) + " h";
  return "il y a " + Math.floor(s / 86400) + " j";
}

function dur(sec) {
  const s = Math.round(sec);
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const CSS = `
.tk *, .tk *::before, .tk *::after { box-sizing: border-box; }
.tk {
  --ink:#171233; --panel:#221B45; --panel2:#2C2456; --line:#3A3168;
  --paper:#EFEAF7; --muted:#9A93BE; --signal:#FFC24B; --live:#5FE3C0;
  --mono: ui-monospace, "SF Mono", "Roboto Mono", Menlo, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--ink); color: var(--paper); font-family: var(--sans);
  min-height: 100vh; display:flex; flex-direction:column;
  max-width: 560px; margin: 0 auto; position: relative;
}
.tk button { font: inherit; color: inherit; background: none; border: none; cursor: pointer; }
.tk input { font: inherit; }
.tk .eyebrow {
  font-family: var(--mono); font-size: 11px; letter-spacing: .22em;
  text-transform: uppercase; color: var(--muted);
}
.tk .hd {
  display:flex; align-items:center; gap:12px; padding:14px 16px;
  border-bottom:1px solid var(--line); position:sticky; top:0;
  background: var(--ink); z-index:5;
}
.tk .hd h1 { margin:0; font-size:17px; font-weight:600; letter-spacing:-.01em; }
.tk .field {
  width:100%; background:var(--panel); border:1px solid var(--line);
  border-radius:12px; padding:13px 14px; color:var(--paper);
  font-family:var(--mono); font-size:15px; outline:none;
}
.tk .field:focus { border-color:var(--signal); }
.tk .field::placeholder { color:var(--muted); font-family:var(--sans); }
.tk .primary {
  background:var(--signal); color:#1A1330; font-weight:700; border-radius:12px;
  padding:13px 18px; letter-spacing:.01em;
}
.tk .primary:disabled { opacity:.35; cursor:default; }
.tk .row {
  display:flex; align-items:center; gap:12px; width:100%;
  padding:13px 16px; text-align:left; border-bottom:1px solid var(--line);
}
.tk .row:active { background:var(--panel); }
.tk .avat {
  width:42px; height:42px; border-radius:13px; flex:0 0 auto;
  display:grid; place-items:center; font-family:var(--mono);
  font-size:15px; font-weight:700; color:#1A1330;
}
.tk .dot { width:7px; height:7px; border-radius:50%; flex:0 0 auto; }
.tk .bub { max-width:78%; padding:9px 12px; border-radius:15px; font-size:15px; line-height:1.4; word-break:break-word; }
.tk .mine { background:var(--signal); color:#1A1330; border-bottom-right-radius:5px; }
.tk .their { background:var(--panel2); color:var(--paper); border-bottom-left-radius:5px; }
.tk .stamp { font-family:var(--mono); font-size:10px; color:var(--muted); margin:3px 4px 0; }
.tk .bar { width:3px; border-radius:2px; flex:0 0 auto; transition:background .12s; }
.tk .ptt {
  width:60px; height:60px; border-radius:50%; flex:0 0 auto;
  display:grid; place-items:center; background:var(--panel2);
  border:1px solid var(--line); touch-action:none; user-select:none;
  -webkit-user-select:none; -webkit-touch-callout:none;
  transition: transform .12s, background .12s;
}
.tk .ptt.on { background:var(--signal); transform:scale(1.06); border-color:var(--signal); }
.tk .ring { position:absolute; inset:-10px; border-radius:50%; border:2px solid var(--signal); opacity:.5; pointer-events:none; }
.tk .note { font-size:12.5px; line-height:1.5; color:var(--muted); }
.tk .warn {
  background:#3A2A1A; border:1px solid #6B4A1C; color:#F2CC8F;
  border-radius:11px; padding:10px 12px; font-size:12.5px; line-height:1.45;
}
@media (prefers-reduced-motion: reduce) {
  .tk .ptt, .tk .bar { transition: none; }
}
`;

const HUES = ["#FFC24B", "#5FE3C0", "#C69BF5", "#F58BA0", "#8BC4F5", "#F5B78B"];
const hue = (n) => {
  let h = 0;
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 997;
  return HUES[h % HUES.length];
};

/* ------------------------------------------------------------------ */
/*  Message vocal                                                      */
/* ------------------------------------------------------------------ */

function Voice({ msg, mine }) {
  const [state, setState] = useState("idle"); // idle | loading | playing | fail
  const [prog, setProg] = useState(0);
  const audioRef = useRef(null);
  const peaks = msg.peaks && msg.peaks.length ? msg.peaks : new Array(26).fill(0.4);

  useEffect(() => () => { if (audioRef.current) audioRef.current.pause(); }, []);

  const toggle = async () => {
    if (state === "playing") {
      audioRef.current.pause();
      setState("idle");
      return;
    }
    if (audioRef.current) {
      audioRef.current.play();
      setState("playing");
      return;
    }
    setState("loading");
    const data = await sget("voice:" + msg.vid);
    if (!data) { setState("fail"); return; }
    const a = new Audio(data);
    a.ontimeupdate = () => {
      if (a.duration && isFinite(a.duration)) setProg(a.currentTime / a.duration);
    };
    a.onended = () => { setState("idle"); setProg(0); a.currentTime = 0; };
    a.onerror = () => setState("fail");
    audioRef.current = a;
    try { await a.play(); setState("playing"); } catch (e) { setState("fail"); }
  };

  const fg = mine ? "#1A1330" : "var(--signal)";
  const bg = mine ? "rgba(26,19,48,.28)" : "rgba(239,234,247,.22)";

  if (state === "fail") {
    return <div className={"bub " + (mine ? "mine" : "their")} style={{ fontSize: 13 }}>
      Vocal introuvable. Il a peut-être été effacé.
    </div>;
  }

  return (
    <div className={"bub " + (mine ? "mine" : "their")} style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 190 }}>
      <button onClick={toggle} aria-label={state === "playing" ? "Mettre en pause" : "Écouter"}
        style={{ width: 30, height: 30, borderRadius: "50%", flex: "0 0 auto", display: "grid", placeItems: "center", background: bg }}>
        {state === "loading"
          ? <span style={{ fontSize: 10, fontFamily: "var(--mono)" }}>…</span>
          : state === "playing"
            ? <span style={{ display: "flex", gap: 3 }}>
                <i style={{ width: 3, height: 11, background: fg, display: "block" }} />
                <i style={{ width: 3, height: 11, background: fg, display: "block" }} />
              </span>
            : <span style={{ width: 0, height: 0, marginLeft: 3, borderLeft: "9px solid " + fg, borderTop: "6px solid transparent", borderBottom: "6px solid transparent" }} />}
      </button>
      <div style={{ display: "flex", alignItems: "center", gap: 2, height: 26, flex: 1 }}>
        {peaks.map((p, i) => (
          <span key={i} className="bar"
            style={{ height: Math.max(3, Math.round(p * 24)), background: i / peaks.length <= prog ? fg : bg }} />
        ))}
      </div>
      <span style={{ fontFamily: "var(--mono)", fontSize: 11, opacity: .8 }}>{dur(msg.dur || 0)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */

export default function Talkie() {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState(null);
  const [draftName, setDraftName] = useState("");
  const [nameErr, setNameErr] = useState("");
  const [roster, setRoster] = useState({});
  const [peer, setPeer] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState("");
  const [newPeer, setNewPeer] = useState("");
  const [previews, setPreviews] = useState({});
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [recSec, setRecSec] = useState(0);
  const [micErr, setMicErr] = useState("");
  const [sending, setSending] = useState(false);

  const bottomRef = useRef(null);
  const recRef = useRef({});
  const peerRef = useRef(null);
  peerRef.current = peer;

  /* --- démarrage --- */
  useEffect(() => {
    (async () => {
      if (!window.storage) { setReady(true); return; }
      const saved = await sget("myname", false);
      if (saved && NAME_RE.test(saved)) setMe(saved);
      setReady(true);
    })();
  }, []);

  /* --- présence + liste --- */
  const pingRoster = useCallback(async () => {
    if (!me) return;
    const r = (await sget(ROSTER)) || {};
    r[me] = now();
    const cut = now() - 1000 * 60 * 60 * 24 * 30;
    Object.keys(r).forEach((k) => { if (r[k] < cut) delete r[k]; });
    await sset(ROSTER, r);
    setRoster(r);
  }, [me]);

  useEffect(() => {
    if (!me) return;
    pingRoster();
    const id = setInterval(pingRoster, 20000);
    return () => clearInterval(id);
  }, [me, pingRoster]);

  /* --- aperçus --- */
  const loadPreviews = useCallback(async (names) => {
    const out = {};
    for (const n of names.slice(0, 8)) {
      const t = await sget(threadKey(me, n));
      if (t && t.length) out[n] = t[t.length - 1];
    }
    setPreviews((p) => ({ ...p, ...out }));
  }, [me]);

  useEffect(() => {
    if (!me || peer) return;
    const others = Object.keys(roster).filter((n) => n !== me);
    if (others.length) loadPreviews(others);
  }, [me, peer, roster, loadPreviews]);

  /* --- fil de discussion --- */
  const pullThread = useCallback(async () => {
    const p = peerRef.current;
    if (!me || !p) return;
    const t = (await sget(threadKey(me, p))) || [];
    setMsgs((prev) => (prev.length === t.length && prev[prev.length - 1]?.id === t[t.length - 1]?.id ? prev : t));
  }, [me]);

  useEffect(() => {
    if (!peer) return;
    setMsgs([]);
    pullThread();
    const id = setInterval(pullThread, 3000);
    return () => clearInterval(id);
  }, [peer, pullThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [msgs.length]);

  /* --- envoi --- */
  const push = async (msg) => {
    const k = threadKey(me, peer);
    const cur = (await sget(k)) || [];
    const next = [...cur, msg].slice(-MAX_MSGS);
    setMsgs(next);
    await sset(k, next);
  };

  const sendText = async () => {
    const v = text.trim();
    if (!v || sending) return;
    setText("");
    setSending(true);
    await push({ id: now() + "-" + Math.random().toString(36).slice(2, 7), from: me, t: now(), kind: "text", text: v.slice(0, 800) });
    setSending(false);
  };

  /* --- enregistrement --- */
  const startRec = async () => {
    setMicErr("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicErr("Ce navigateur ne sait pas enregistrer le micro.");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setMicErr("Micro refusé. Autorise le micro, ou ouvre l'appli en plein écran dans ton navigateur.");
      return;
    }
    let mime = "";
    for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) {
      if (MediaRecorder.isTypeSupported?.(m)) { mime = m; break; }
    }
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    const chunks = [];
    const peaks = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

    let ctx, raf;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      let last = 0;
      const tick = (ts) => {
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d; }
        const rms = Math.min(1, Math.sqrt(sum / buf.length) * 3.2);
        setLevel(rms);
        if (ts - last > 90) { peaks.push(rms); last = ts; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch (e) { /* niveau indisponible, on enregistre quand même */ }

    const t0 = now();
    recRef.current = { mr, stream, chunks, peaks, t0, ctx, raf, cancel: false };
    mr.start();
    setRecording(true);
    setRecSec(0);
    recRef.current.timer = setInterval(() => {
      const s = (now() - t0) / 1000;
      setRecSec(s);
      if (s >= MAX_SEC) stopRec(false);
    }, 200);
  };

  const stopRec = (cancel) => {
    const r = recRef.current;
    if (!r.mr || r.done) return;
    r.done = true;
    r.cancel = cancel;
    clearInterval(r.timer);
    if (r.raf) cancelAnimationFrame(r.raf);
    const seconds = (now() - r.t0) / 1000;
    r.mr.onstop = async () => {
      r.stream.getTracks().forEach((t) => t.stop());
      r.ctx?.close?.();
      setRecording(false);
      setLevel(0);
      if (cancel || seconds < 0.7) return;
      const blob = new Blob(r.chunks, { type: r.mr.mimeType || "audio/webm" });
      const data = await new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.readAsDataURL(blob);
      });
      if (data.length > 4_500_000) { setMicErr("Vocal trop lourd. Fais plus court."); return; }
      const vid = now() + "-" + Math.random().toString(36).slice(2, 7);
      setSending(true);
      const ok = await sset("voice:" + vid, data);
      if (!ok) { setMicErr("Envoi impossible. Réessaie."); setSending(false); return; }
      // 26 barres à partir des niveaux mesurés
      const src = r.peaks.length ? r.peaks : [0.4];
      const bars = Array.from({ length: 26 }, (_, i) => {
        const a = Math.floor((i * src.length) / 26);
        const b = Math.max(a + 1, Math.floor(((i + 1) * src.length) / 26));
        return Math.round(Math.max(...src.slice(a, b)) * 100) / 100;
      });
      await push({ id: vid, from: me, t: now(), kind: "voice", vid, dur: seconds, peaks: bars });
      setSending(false);
    };
    try { r.mr.stop(); } catch (e) { setRecording(false); }
  };

  /* --- écrans --- */

  if (!ready) return <div className="tk"><style>{CSS}</style></div>;

  if (!window.storage) {
    return (
      <div className="tk" style={{ padding: 24 }}>
        <style>{CSS}</style>
        <div className="warn">Le stockage partagé n'est pas disponible ici. Ouvre l'appli depuis le lien partagé pour qu'elle fonctionne.</div>
      </div>
    );
  }

  /* Écran 1 — indicatif */
  if (!me) {
    const ok = NAME_RE.test(draftName.trim().toLowerCase());
    return (
      <div className="tk" style={{ padding: "48px 24px", gap: 22, justifyContent: "center" }}>
        <style>{CSS}</style>
        <div>
          <div className="eyebrow">Canal ouvert</div>
          <h1 style={{ fontSize: 30, margin: "10px 0 0", letterSpacing: "-.02em", lineHeight: 1.15 }}>
            Choisis ton indicatif
          </h1>
          <p className="note" style={{ marginTop: 10 }}>
            C'est le nom que tes potes verront et taperont pour t'écrire. 2 à 14 caractères : lettres, chiffres, <code>-</code> et <code>_</code>.
          </p>
        </div>
        <input
          className="field"
          value={draftName}
          placeholder="ex : lucas_92"
          autoCapitalize="none"
          autoCorrect="off"
          maxLength={14}
          onChange={(e) => { setDraftName(e.target.value); setNameErr(""); }}
          onKeyDown={(e) => { if (e.key === "Enter" && ok) confirmName(); }}
        />
        {nameErr && <div className="note" style={{ color: "#F58BA0" }}>{nameErr}</div>}
        <button className="primary" disabled={!ok} onClick={() => confirmName()}>Entrer</button>
        <div className="warn">
          Tout le monde qui a ce lien peut lire les conversations et les vocaux. Ne mets rien de sensible ici.
        </div>
      </div>
    );

    async function confirmName() {
      const n = draftName.trim().toLowerCase();
      if (!NAME_RE.test(n)) return;
      const r = (await sget(ROSTER)) || {};
      if (r[n] && now() - r[n] < 1000 * 60 * 5) {
        setNameErr("Cet indicatif est déjà utilisé en ce moment. Prends-en un autre.");
        return;
      }
      await sset("myname", n, false);
      setMe(n);
    }
  }

  /* Écran 3 — conversation */
  if (peer) {
    const seen = roster[peer];
    const online = seen && now() - seen < 60000;
    return (
      <div className="tk">
        <style>{CSS}</style>
        <div className="hd">
          <button onClick={() => { setPeer(null); setMicErr(""); }} aria-label="Retour"
            style={{ fontSize: 22, lineHeight: 1, padding: "0 2px" }}>←</button>
          <div className="avat" style={{ background: hue(peer), width: 34, height: 34, borderRadius: 11, fontSize: 13 }}>
            {peer.slice(0, 2).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontFamily: "var(--mono)" }}>{peer}</h1>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              <span className="dot" style={{ background: online ? "var(--live)" : "var(--muted)" }} />
              <span className="eyebrow" style={{ letterSpacing: ".08em" }}>
                {online ? "en ligne" : seen ? "vu " + ago(seen) : "jamais vu"}
              </span>
            </div>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 14px 8px", display: "flex", flexDirection: "column", gap: 10 }}>
          {!msgs.length && (
            <div className="note" style={{ textAlign: "center", padding: "40px 20px" }}>
              Rien ici pour l'instant.<br />Écris un message, ou maintiens le bouton rond pour parler.
            </div>
          )}
          {msgs.map((m, i) => {
            const mine = m.from === me;
            const showTime = i === msgs.length - 1 || msgs[i + 1].from !== m.from || msgs[i + 1].t - m.t > 300000;
            return (
              <div key={m.id + i} style={{ display: "flex", flexDirection: "column", alignItems: mine ? "flex-end" : "flex-start" }}>
                {m.kind === "voice"
                  ? <Voice msg={m} mine={mine} />
                  : <div className={"bub " + (mine ? "mine" : "their")}>{m.text}</div>}
                {showTime && <div className="stamp">{clock(m.t)}</div>}
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>

        {micErr && <div style={{ padding: "0 14px 10px" }}><div className="warn">{micErr}</div></div>}

        {recording && (
          <div style={{ padding: "0 16px 10px", display: "flex", alignItems: "center", gap: 10 }}>
            <span className="dot" style={{ background: "var(--signal)", width: 9, height: 9 }} />
            <span className="eyebrow" style={{ color: "var(--signal)" }}>
              Enregistrement {dur(recSec)} — relâche pour envoyer
            </span>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px 16px", borderTop: "1px solid var(--line)" }}>
          <input
            className="field"
            style={{ flex: 1, fontFamily: "var(--sans)" }}
            placeholder="Message"
            value={text}
            maxLength={800}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
          />
          {text.trim()
            ? <button className="primary" onClick={sendText} style={{ padding: "13px 16px" }}>Envoyer</button>
            : <div style={{ position: "relative", display: "grid", placeItems: "center" }}>
                {recording && <span className="ring" style={{ transform: `scale(${1 + level * 0.5})` }} />}
                <button
                  className={"ptt" + (recording ? " on" : "")}
                  aria-label="Maintiens pour enregistrer un vocal"
                  onPointerDown={(e) => { e.preventDefault(); startRec(); }}
                  onPointerUp={() => stopRec(false)}
                  onPointerLeave={() => recording && stopRec(true)}
                  onPointerCancel={() => stopRec(true)}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                    stroke={recording ? "#1A1330" : "var(--signal)"} strokeWidth="2" strokeLinecap="round">
                    <rect x="9" y="2.5" width="6" height="11" rx="3" fill={recording ? "#1A1330" : "none"} />
                    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                  </svg>
                </button>
              </div>}
        </div>
        {sending && <div className="eyebrow" style={{ padding: "0 16px 12px" }}>Envoi…</div>}
      </div>
    );
  }

  /* Écran 2 — canaux */
  const others = Object.keys(roster).filter((n) => n !== me).sort((a, b) => (roster[b] || 0) - (roster[a] || 0));
  const openable = NAME_RE.test(newPeer.trim().toLowerCase()) && newPeer.trim().toLowerCase() !== me;

  return (
    <div className="tk">
      <style>{CSS}</style>
      <div className="hd">
        <div className="avat" style={{ background: hue(me), width: 34, height: 34, borderRadius: 11, fontSize: 13 }}>
          {me.slice(0, 2).toUpperCase()}
        </div>
        <div style={{ flex: 1 }}>
          <div className="eyebrow">Connecté en tant que</div>
          <h1 style={{ fontFamily: "var(--mono)" }}>{me}</h1>
        </div>
        <button className="eyebrow" onClick={pingRoster} style={{ padding: 6 }}>Actualiser</button>
      </div>

      <div style={{ padding: "16px 16px 10px", display: "flex", gap: 8 }}>
        <input
          className="field"
          style={{ flex: 1 }}
          placeholder="Ouvrir un canal avec…"
          value={newPeer}
          autoCapitalize="none"
          autoCorrect="off"
          maxLength={14}
          onChange={(e) => setNewPeer(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && openable) { setPeer(newPeer.trim().toLowerCase()); setNewPeer(""); } }}
        />
        <button className="primary" disabled={!openable}
          onClick={() => { setPeer(newPeer.trim().toLowerCase()); setNewPeer(""); }}>Ouvrir</button>
      </div>
      <div className="note" style={{ padding: "0 16px 14px" }}>
        Tape l'indicatif exact de ton pote, même s'il n'est pas encore dans la liste.
      </div>

      <div className="eyebrow" style={{ padding: "8px 16px" }}>Sur le canal</div>
      {!others.length && (
        <div className="note" style={{ padding: "22px 16px" }}>
          Personne d'autre pour l'instant. Partage le lien de cette appli à ton pote : dès qu'il choisit son indicatif, il apparaît ici.
        </div>
      )}
      {others.map((n) => {
        const online = now() - roster[n] < 60000;
        const p = previews[n];
        return (
          <button key={n} className="row" onClick={() => setPeer(n)}>
            <div className="avat" style={{ background: hue(n) }}>{n.slice(0, 2).toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span className="dot" style={{ background: online ? "var(--live)" : "var(--muted)" }} />
                <span style={{ fontFamily: "var(--mono)", fontSize: 15, fontWeight: 600 }}>{n}</span>
              </div>
              <div className="note" style={{ marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {p ? (p.kind === "voice" ? "🎙 Vocal · " + dur(p.dur || 0) : (p.from === me ? "Toi : " : "") + p.text) : (online ? "en ligne" : "vu " + ago(roster[n]))}
              </div>
            </div>
            {p && <span className="stamp" style={{ margin: 0 }}>{clock(p.t)}</span>}
          </button>
        );
      })}

      <div style={{ padding: 16, marginTop: "auto" }}>
        <div className="warn">
          Tout le monde qui a ce lien peut lire les conversations et écouter les vocaux. Ne mets rien de sensible ici.
        </div>
        <button className="eyebrow" style={{ marginTop: 14, padding: 6 }}
          onClick={async () => { await window.storage.delete("myname", false).catch(() => {}); setMe(null); setDraftName(""); }}>
          Changer d'indicatif
        </button>
      </div>
    </div>
  );
}
