export const WEB_UI_HTML = `
<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Omni - panel sterowania</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Ctext y=%2226%22 font-size=%2226%22%3E%F0%9F%A4%96%3C/text%3E%3C/svg%3E" />
<style>
*{box-sizing:border-box}
html,body{margin:0;height:100%;background:#0b0f14;color:#e6edf6;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
#app{display:flex;height:100vh;overflow:hidden}
.sidebar{width:262px;flex:0 0 262px;background:#0e141d;border-right:1px solid #1e2a3a;display:flex;flex-direction:column;padding:14px 10px}
.brand{display:flex;gap:10px;align-items:center;padding:6px 8px 14px}
.logo{width:38px;height:38px;border-radius:11px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:18px}
.brand-name{font-weight:700;font-size:16px}
.brand-sub{font-size:11px;color:#8ba0b8}
.nav{flex:1;overflow:auto;display:flex;flex-direction:column;gap:2px}
.nav-group{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#5d7characters;color:#5d7391;padding:12px 10px 5px}
.nav-item{display:flex;gap:10px;align-items:center;width:100%;text-align:left;background:transparent;border:0;color:#c3d2e4;padding:9px 10px;border-radius:9px;font-size:13.5px;cursor:pointer}
.nav-item:hover{background:#151f2c}
.nav-item.active{background:#1b2theme;background:#1b2a3d;color:#fff}
.ico{width:20px;height:20px;border-radius:6px;background:#1b2a3d;display:flex;align-items:center;justify-content:center;font-size:11px;color:#8bb6f0}
.side-foot{display:flex;gap:10px;align-items:center;border-top:1px solid #1e2a3a;padding:12px 8px 4px;margin-top:8px}
.dot{width:9px;height:9px;border-radius:50%;background:#64748b}
.dot.on{background:#22c55e;box-shadow:0 0 8px #22c55e}
.foot-name{font-size:13px;font-weight:600}
.foot-sub{font-size:11px;color:#8ba0b8}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid #1e2a3a;background:#0d131c}
.topbar h1{font-size:17px;margin:0}
.pills{display:flex;gap:8px}
.pill{font-size:11.5px;background:#151f2c;border:1px solid #1e2a3a;color:#9fb3c9;padding:4px 10px;border-radius:999px}
.page{flex:1;overflow:auto;padding:22px}
.hidden{display:none}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.card{background:#111823;border:1px solid #1e2a3a;border-radius:14px;padding:16px}
.card h2{font-size:13px;margin:0 0 12px;color:#cfe0f2;text-transform:uppercase;letter-spacing:.08em}
.mut{color:#8ba0b8;font-size:12.5px;line-height:1.5}
.small{font-size:11.5px}
input[type=text],input[type=password],select,textarea{width:100%;background:#0b1119;border:1px solid #23324a;color:#e6edf6;border-radius:9px;padding:10px 12px;font-size:13.5px;margin:6px 0;outline:none}
input:focus,select:focus,textarea:focus{border-color:#3b82f6}
.btn{background:#182435;border:1px solid #26364d;color:#dbe7f5;border-radius:9px;padding:9px 14px;font-size:13px;cursor:pointer}
.btn:hover{background:#1e2e44}
.btn.primary{background:#2563eb;border-color:#2563eb;color:#fff}
.btn.primary:hover{background:#1d4ed8}
.btn.big{width:100%;padding:13px;font-size:14px;font-weight:600}
.btn.ghost{background:transparent}
.opt{display:flex;gap:10px;align-items:flex-start;border:1px solid #23324a;border-radius:11px;padding:12px;margin:8px 0;cursor:pointer}
.opt input{margin-top:3px}
.opt b{display:block;font-size:13.5px}
.opt span{font-size:12px;color:#8ba0b8}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.lbl{display:block;font-size:11.5px;color:#8ba0b8;margin-top:10px}
.chat-wrap{display:flex;flex-direction:column;height:100%;max-width:900px;margin:0 auto}
.chat-log{flex:1;overflow:auto;display:flex;flex-direction:column;gap:12px;padding:8px 4px}
.msg{max-width:78%;padding:11px 14px;border-radius:14px;font-size:14px;line-height:1.55;white-space:pre-wrap}
.msg.user{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:4px}
.msg.bot{align-self:flex-start;background:#151f2c;border:1px solid #1e2a3a;border-bottom-left-radius:4px}
.msg.sys{align-self:center;background:transparent;color:#8ba0b8;font-size:12px}
.composer{display:flex;gap:8px;align-items:flex-end;border-top:1px solid #1e2a3a;padding-top:12px}
.composer textarea{margin:0;resize:none}
.kv{display:grid;grid-template-columns:200px 1fr;gap:8px 14px;font-size:13px}
.kv div:nth-child(odd){color:#8ba0b8}
.out{background:#0b1119;border:1px solid #23324a;border-radius:9px;padding:10px;font-size:12px;color:#a8c6e8;white-space:pre-wrap;max-height:220px;overflow:auto}
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#152238;border:1px solid #26364d;padding:12px 18px;border-radius:11px;font-size:13.5px;z-index:50;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.toast.ok{border-color:#22c55e}
.toast.err{border-color:#ef4444}
.badge{display:inline-block;font-size:11px;padding:2px 8px;border-radius:999px;background:#182435;border:1px solid #26364d;color:#9fb3c9}
.badge.ok{color:#22c55e;border-color:#1c5a37}
.badge.err{color:#ef4444;border-color:#5a2323}
.list{display:flex;flex-direction:column;gap:8px}
.item{background:#0e141d;border:1px solid #1e2a3a;border-radius:10px;padding:11px 13px;font-size:13px}
.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px}
</style>
</head>
<body>
<div id="app">
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">O</div>
      <div><div class="brand-name">Omni</div><div class="brand-sub">panel sterowania</div></div>
    </div>
    <nav class="nav">
      <div class="nav-group">Rozmowa</div>
      <button class="nav-item active" data-page="chat"><span class="ico">C</span>Czat</button>
      <div class="nav-group">Konfiguracja</div>
      <button class="nav-item" data-page="keys"><span class="ico">K</span>Modele i klucze API</button>
      <button class="nav-item" data-page="engines"><span class="ico">S</span>Silniki</button>
      <button class="nav-item" data-page="settings"><span class="ico">U</span>Ustawienia</button>
      <div class="nav-group">Praca</div>
      <button class="nav-item" data-page="sessions"><span class="ico">S</span>Sesje</button>
      <button class="nav-item" data-page="tasks"><span class="ico">Z</span>Zadania</button>
      <div class="nav-group">System</div>
      <button class="nav-item" data-page="status"><span class="ico">D</span>Status i diagnostyka</button>
    </nav>
    <div class="side-foot">
      <div class="dot" id="connDot"></div>
      <div><div class="foot-name" id="userName">Wlasciciel</div><div class="foot-sub" id="footEngine">silnik: -</div></div>
    </div>
  </aside>
  <main class="main">
    <header class="topbar">
      <h1 id="pageTitle">Czat</h1>
      <div class="pills"><span class="pill" id="pillEngine">-</span><span class="pill" id="pillModel">-</span></div>
    </header>

    <section class="page" id="page-chat">
      <div class="chat-wrap">
        <div class="chat-log" id="chatLog"></div>
        <div class="composer">
          <textarea id="chatInput" rows="2" placeholder="Napisz wiadomosc i nacisnij Enter (Shift+Enter = nowa linia)"></textarea>
          <button class="btn primary" id="sendBtn">Wyslij</button>
        </div>
      </div>
    </section>

    <section class="page hidden" id="page-keys">
      <div class="grid">
        <div class="card">
          <h2>1. Wybierz silnik</h2>
          <label class="opt"><input type="radio" name="provider" value="openrouter" /><div><b>Chmura - darmowe modele (OpenRouter)</b><span>Najszybciej i najmocniej. Wymaga darmowego klucza.</span></div></label>
          <label class="opt"><input type="radio" name="provider" value="ollama" /><div><b>Lokalnie (Ollama)</b><span>Dziala offline, wolniejszy, slabszy.</span></div></label>
        </div>
        <div class="card">
          <h2>2. Klucz API</h2>
          <p class="mut" id="keyState">sprawdzam...</p>
          <input type="password" id="apiKey" placeholder="sk-or-..." autocomplete="off" />
          <div class="row">
            <button class="btn primary" id="oauthBtn">Polacz z OpenRouter (OAuth)</button>
            <button class="btn" id="delKeyBtn">Usun klucz</button>
          </div>
          <p class="mut small">Darmowy klucz: openrouter.ai/keys - albo kliknij OAuth i zaloguj sie przegladarka.</p>
        </div>
        <div class="card">
          <h2>3. Model</h2>
          <select id="modelSelect"></select>
          <input type="text" id="modelCustom" placeholder="albo wpisz wlasna nazwe modelu" />
          <label class="lbl">Model mocniejszy (do sprawdzania i kodu)</label>
          <input type="text" id="modelPro" />
          <label class="lbl">Adres lokalnego serwera (Ollama)</label>
          <input type="text" id="ollamaUrl" />
        </div>
        <div class="card">
          <h2>4. Zapisz i przetestuj</h2>
          <button class="btn primary big" id="saveBtn">Zapisz i przelacz silnik</button>
          <div class="row"><button class="btn" id="testBtn">Test odpowiedzi</button></div>
          <pre class="out" id="testOut">tu pojawi sie wynik testu</pre>
        </div>
      </div>
    </section>

    <section class="page hidden" id="page-engines">
      <div class="grid">
        <div class="card"><h2>Aktywny silnik</h2><div class="kv" id="engineKv"></div></div>
        <div class="card"><h2>Ollama (lokalnie)</h2><div id="ollamaBox" class="mut">sprawdzam...</div></div>
        <div class="card"><h2>OpenRouter (chmura)</h2><div id="cloudBox" class="mut">sprawdzam...</div></div>
      </div>
    </section>

    <section class="page hidden" id="page-sessions">
      <div class="card"><h2>Sesje</h2><div class="list" id="sessionsList"></div></div>
    </section>

    <section class="page hidden" id="page-tasks">
      <div class="card"><h2>Ostatnie zadania</h2><div class="list" id="tasksList"></div></div>
    </section>

    <section class="page hidden" id="page-settings">
      <div class="grid">
        <div class="card">
          <h2>Wyglad i jezyk</h2>
          <label class="lbl">Nazwa bota</label><input type="text" id="botName" />
          <label class="lbl">Jezyk</label><select id="lang"><option value="pl">Polski</option><option value="en">English</option></select>
          <label class="lbl">Motyw</label><select id="theme"><option value="dark">Ciemny</option><option value="light">Jasny</option></select>
          <div class="row"><button class="btn primary" id="saveSettings">Zapisz ustawienia</button></div>
        </div>
        <div class="card">
          <h2>Konserwacja</h2>
          <p class="mut">Przeladuj silnik, jesli zmieniles klucz lub model poza panelem.</p>
          <div class="row"><button class="btn" id="reloadEngine">Przeladuj silnik</button></div>
        </div>
      </div>
    </section>

    <section class="page hidden" id="page-status">
      <div class="card"><h2>Status systemu</h2><div class="kv" id="statusKv"></div></div>
    </section>
  </main>
</div>
<div class="toast hidden" id="toast"></div>
<script>
var state = { config: null, status: null, ws: null, pending: false };
function el(id){ return document.getElementById(id); }
function toast(msg, kind){
  var t = el("toast");
  t.className = "toast " + (kind || "");
  t.textContent = msg;
  clearTimeout(t._h);
  t._h = setTimeout(function(){ t.className = "toast hidden"; }, 4200);
}
function api(path, opts){
  return fetch(path, opts).then(function(r){
    return r.json().catch(function(){ return {}; }).then(function(j){
      if(!r.ok){ throw new Error(j.error || ("HTTP " + r.status)); }
      return j;
    });
  });
}
function esc(s){ return String(s == null ? "" : s).replace(/[&<>]/g, function(c){ return c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"; }); }
var TITLES = { chat:"Czat", keys:"Modele i klucze API", engines:"Silniki", sessions:"Sesje", tasks:"Zadania", settings:"Ustawienia", status:"Status i diagnostyka" };
function show(page){
  var pages = document.querySelectorAll(".page");
  for(var i=0;i<pages.length;i++){ pages[i].className = "page hidden"; }
  var target = el("page-" + page);
  if(target){ target.className = "page"; }
  var items = document.querySelectorAll(".nav-item");
  for(var k=0;k<items.length;k++){ items[k].className = "nav-item" + (items[k].getAttribute("data-page") === page ? " active" : ""); }
  el("pageTitle").textContent = TITLES[page] || page;
  if(page === "engines"){ renderEngines(); }
  if(page === "sessions"){ loadSessions(); }
  if(page === "tasks"){ loadTasks(); }
  if(page === "status"){ renderStatus(); }
  if(location.hash !== "#" + page){ location.hash = page; }
}
function fillConfig(c){
  state.config = c;
  if(c.provider){ var r = document.querySelector("input[name=provider][value=" + c.provider + "]"); if(r){ r.checked = true; } }
  el("modelSelect").innerHTML = "";
  var presets = (state.status && state.status.presets) || [];
  for(var i=0;i<presets.length;i++){
    var p = presets[i];
    var o = document.createElement("option");
    o.value = p.id; o.textContent = p.label + " (" + p.provider + ")";
    el("modelSelect").appendChild(o);
  }
  var cur = document.createElement("option");
  cur.value = c.model; cur.textContent = "obecny: " + c.model;
  el("modelSelect").appendChild(cur);
  el("modelSelect").value = c.model;
  el("modelCustom").value = c.model;
  el("modelPro").value = c.modelPro;
  el("ollamaUrl").value = c.ollamaBaseUrl;
  el("botName").value = c.botName || "Omni";
  el("lang").value = c.language || "pl";
  el("userName").textContent = "Wlasciciel";
}
function renderPills(){
  var c = state.config || {};
  el("pillEngine").textContent = (c.provider === "openrouter" ? "chmura (OpenRouter)" : "lokalnie (Ollama)");
  el("pillModel").textContent = c.model || "-";
  el("footEngine").textContent = "silnik: " + (c.provider || "-");
}
function renderEngines(){
  var c = state.config || {};
  var s = state.status || {};
  el("engineKv").innerHTML =
    "<div>Silnik</div><div>" + esc(c.provider) + "</div>" +
    "<div>Model</div><div>" + esc(c.model) + "</div>" +
    "<div>Model mocniejszy</div><div>" + esc(c.modelPro) + "</div>" +
    "<div>Serwer lokalny</div><div class=mono>" + esc(c.ollamaBaseUrl) + "</div>";
  var o = (s.ollama) || {};
  el("ollamaBox").innerHTML = (o.ok ? "<span class=badge ok>dziala</span>" : "<span class=badge err>brak polaczenia</span>") +
    "<p class=small>Adres: " + esc(o.url || "-") + "</p>" +
    "<p class=small>Modele: " + esc((o.models && o.models.length) ? o.models.join(", ") : "brak / nie sprawdzono") + "</p>";
  el("cloudBox").innerHTML = (s.hasOpenRouterKey ? "<span class=badge ok>klucz zapisany</span>" : "<span class=badge err>brak klucza</span>") +
    "<p class=small>Klucz pozwala korzystac z darmowych modeli w chmurze.</p>";
  el("keyState").innerHTML = s.hasOpenRouterKey ? "<span class=badge ok>klucz zapisany</span> Wpisz nowy, aby go zmienic." : "<span class=badge err>brak klucza</span> Wklej klucz albo uzyj OAuth.";
}
function renderStatus(){
  var s = state.status || {};
  el("statusKv").innerHTML =
    "<div>Stan</div><div>" + (s.status === "ok" ? "<span class=badge ok>dziala</span>" : "<span class=badge err>blad</span>") + "</div>" +
    "<div>Wersja</div><div class=mono>" + esc(s.version || "-") + "</div>" +
    "<div>Czas dzialania</div><div>" + esc(Math.round((s.uptime || 0) / 60) + " min") + "</div>" +
    "<div>Silnik</div><div>" + esc(s.provider) + "</div>" +
    "<div>Model</div><div class=mono>" + esc(s.model) + "</div>" +
    "<div>Klucz OpenRouter</div><div>" + (s.hasOpenRouterKey ? "tak" : "nie") + "</div>" +
    "<div>Sesje WebSocket</div><div>" + esc(s.sessions) + "</div>" +
    "<div>Zapisane klucze</div><div class=mono>" + esc((s.keyNames || []).join(", ") || "brak") + "</div>";
}
function loadStatus(){
  return api("/api/status").then(function(s){
    state.status = s;
    var dot = el("connDot");
    dot.className = "dot on";
    renderPills(); renderEngines(); renderStatus();
    return s;
  });
}
function loadConfig(){
  return api("/api/config").then(function(c){ fillConfig(c); renderPills(); });
}
function sendMessage(){
  var box = el("chatInput");
  var text = (box.value || "").trim();
  if(!text || state.pending){ return; }
  box.value = "";
  addMsg("user", text);
  state.pending = true;
  var ws = state.ws;
  if(ws && ws.readyState === 1){
    ws.send(JSON.stringify({ type: "task.create", prompt: text }));
    addMsg("sys", "mysle...");
  } else {
    api("/api/tasks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text }) })
      .then(function(t){ addMsg("bot", t.result || "(brak tresci)"); state.pending = false; })
      .catch(function(e){ addMsg("sys", "Blad: " + e.message); state.pending = false; });
  }
}
function addMsg(kind, text){
  var d = document.createElement("div");
  d.className = "msg " + kind;
  d.textContent = text;
  el("chatLog").appendChild(d);
  el("chatLog").scrollTop = el("chatLog").scrollHeight;
  return d;
}
function connectWs(){
  try {
    var ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws");
    state.ws = ws;
    ws.onmessage = function(ev){
      var m = {};
      try { m = JSON.parse(ev.data); } catch(e){ return; }
      if(m.type === "task.started"){ return; }
      if(m.type === "task.finished"){
        state.pending = false;
        var logs = document.querySelectorAll("#chatLog .msg.sys");
        if(logs.length){ logs[logs.length-1].remove(); }
        if(m.error){ addMsg("sys", "Blad: " + m.error); }
        else { addMsg("bot", m.result || "(brak tresci)"); }
      }
    };
    ws.onclose = function(){ el("connDot").className = "dot"; setTimeout(connectWs, 3000); };
  } catch(e){ el("connDot").className = "dot"; }
}
function loadSessions(){
  api("/api/sessions").then(function(d){
    el("sessionsList").innerHTML = (d.sessions || []).length ? d.sessions.map(function(s){
      return "<div class=item><b>" + esc(s.id) + "</b><div class=mut>" + esc(s.status || "") + " &middot; " + esc(new Date(s.updatedAt || Date.now()).toLocaleString()) + "</div></div>";
    }).join("") : "<div class=mut>Brak sesji.</div>";
  }).catch(function(e){ el("sessionsList").innerHTML = "<div class=mut>Blad: " + esc(e.message) + "</div>"; });
}
function loadTasks(){
  api("/api/tasks").then(function(d){
    el("tasksList").innerHTML = (d.tasks || []).length ? d.tasks.map(function(t){
      return "<div class=item><b>" + esc(t.status) + "</b> <span class=mut>" + esc(new Date(t.createdAt || Date.now()).toLocaleString()) + "</span><div class=mut>" + esc((t.prompt || "").slice(0, 180)) + "</div></div>";
    }).join("") : "<div class=mut>Brak zadan.</div>";
  }).catch(function(e){ el("tasksList").innerHTML = "<div class=mut>Blad: " + esc(e.message) + "</div>"; });
}
function collect(){
  var r = document.querySelector("input[name=provider]:checked");
  var custom = (el("modelCustom").value || "").trim();
  var chosen = (el("modelSelect").value || "").trim();
  var key = (el("apiKey").value || "").trim();
  var body = {
    provider: r ? r.value : undefined,
    model: custom || chosen,
    modelPro: (el("modelPro").value || "").trim(),
    ollamaBaseUrl: (el("ollamaUrl").value || "").trim(),
    botName: (el("botName").value || "").trim(),
    language: el("lang").value
  };
  if(key){ body.apiKeys = { OPENROUTER_API_KEY: key }; }
  return body;
}
function saveConfig(){
  var body = collect();
  return api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(function(){ el("apiKey").value = ""; toast("Zapisano. Silnik przelaczony.", "ok"); return loadConfig(); })
    .then(function(){ return loadStatus(); })
    .catch(function(e){ toast("Blad: " + e.message, "err"); });
}
function runTest(){
  el("testOut").textContent = "testuje...";
  api("/api/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) })
    .then(function(d){ el("testOut").textContent = d.answer || "(brak odpowiedzi)"; })
    .catch(function(e){ el("testOut").textContent = "Blad: " + e.message; });
}
function boot(){
  var items = document.querySelectorAll(".nav-item");
  for(var i=0;i<items.length;i++){
    items[i].addEventListener("click", function(){ show(this.getAttribute("data-page")); });
  }
  el("sendBtn").addEventListener("click", sendMessage);
  el("chatInput").addEventListener("keydown", function(e){ if(e.key === "Enter" && !e.shiftKey){ e.preventDefault(); sendMessage(); } });
  el("saveBtn").addEventListener("click", saveConfig);
  el("testBtn").addEventListener("click", runTest);
  el("oauthBtn").addEventListener("click", function(){ location.href = "/oauth/openrouter/start"; });
  el("delKeyBtn").addEventListener("click", function(){
    api("/api/keys/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "OPENROUTER_API_KEY" }) })
      .then(function(){ toast("Klucz usuniety.", "ok"); return loadStatus(); })
      .catch(function(e){ toast("Blad: " + e.message, "err"); });
  });
  el("saveSettings").addEventListener("click", function(){
    var theme = el("theme").value;
    try { localStorage.setItem("omniTheme", theme); } catch(e){}
    document.body.style.background = theme === "light" ? "#f4f7fb" : "#0b0f14";
    saveConfig();
  });
  el("reloadEngine").addEventListener("click", function(){ saveConfig(); });
  var hash = (location.hash || "#chat").replace("#", "");
  show(hash);
  loadStatus().then(loadConfig).catch(function(e){ addMsg("sys", "Nie moge wczytac konfiguracji: " + e.message); });
  connectWs();
  addMsg("bot", "Czesc! Jestem Omni. Ustaw klucz API w zakladce Modele i klucze API, zebym odpowiadal szybko.");
}
document.addEventListener("DOMContentLoaded", boot);
</script>
</body>
</html>
`;
