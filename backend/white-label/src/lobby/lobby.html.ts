// Minimal single-page lobby. Login -> game list -> launch token -> iframe.
// Same-origin calls to /auth/login and /sessions/launch (no CORS needed).
export const LOBBY_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>White-Label Casino — Lobby</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, sans-serif; background: #0e1116; color: #e6e6e6; }
    header { display: flex; align-items: center; justify-content: space-between;
      padding: 12px 20px; background: #161b22; border-bottom: 1px solid #21262d; }
    header .brand { font-weight: 700; letter-spacing: .5px; }
    header .player { font-size: 14px; color: #9aa4b2; }
    header .player b { color: #58d6a0; }
    main { max-width: 980px; margin: 0 auto; padding: 24px 20px; }
    .card { background: #161b22; border: 1px solid #21262d; border-radius: 10px; padding: 20px; }
    .login { max-width: 360px; margin: 8vh auto; }
    label { display: block; font-size: 13px; color: #9aa4b2; margin: 12px 0 4px; }
    input { width: 100%; padding: 10px 12px; border-radius: 8px; border: 1px solid #30363d;
      background: #0e1116; color: #e6e6e6; font-size: 15px; }
    button { margin-top: 16px; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px;
      background: #2f81f7; color: #fff; font-size: 15px; font-weight: 600; cursor: pointer; }
    button.ghost { background: #21262d; color: #e6e6e6; width: auto; padding: 8px 14px; margin: 0; }
    .games { display: flex; gap: 16px; flex-wrap: wrap; }
    .game { width: 220px; }
    .game h3 { margin: 0 0 6px; }
    .hidden { display: none; }
    .error { color: #f85149; font-size: 13px; margin-top: 10px; min-height: 16px; }
    .frame-wrap { margin-top: 20px; }
    iframe { width: 100%; height: 640px; border: 1px solid #21262d; border-radius: 10px; background: #000; }
    .muted { color: #9aa4b2; font-size: 13px; }
  </style>
</head>
<body>
  <header>
    <span class="brand">🎰 WHITE-LABEL CASINO</span>
    <span class="player" id="playerBar"></span>
  </header>

  <main>
    <section id="loginView" class="card login">
      <h2>Sign in</h2>
      <label for="username">Username</label>
      <input id="username" autocomplete="username" value="demo1" />
      <label for="password">Password</label>
      <input id="password" type="password" autocomplete="current-password" value="demo1" />
      <button id="loginBtn">Log in</button>
      <div class="error" id="loginError"></div>
      <p class="muted">Demo accounts: demo1 / demo1, demo2 / demo2</p>
    </section>

    <section id="lobbyView" class="hidden">
      <div class="card">
        <h2>Games</h2>
        <div class="games">
          <div class="game card">
            <h3>{{GAME_ID}}</h3>
            <p class="muted">Crash multiplier game</p>
            <button class="ghost" id="playBtn">Play</button>
          </div>
        </div>
        <div class="error" id="lobbyError"></div>
      </div>

      <div class="frame-wrap hidden" id="frameWrap">
        <iframe id="gameFrame" sandbox="allow-scripts allow-same-origin"
          allow="autoplay"></iframe>
      </div>
    </section>
  </main>

  <script>
    var state = { token: null, player: null, gameOrigin: null };

    function fmt(minor, currency) {
      return (minor / 100).toFixed(2) + ' ' + currency;
    }

    function renderPlayer() {
      var bar = document.getElementById('playerBar');
      if (!state.player) { bar.textContent = ''; return; }
      bar.innerHTML = state.player.displayName + ' — <b>' +
        fmt(state.player.balance, state.player.currency) + '</b>';
    }

    async function login() {
      var err = document.getElementById('loginError');
      err.textContent = '';
      try {
        var res = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: document.getElementById('username').value,
            password: document.getElementById('password').value,
          }),
        });
        var data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || 'Login failed');
        state.token = data.token;
        state.player = data.player;
        renderPlayer();
        document.getElementById('loginView').classList.add('hidden');
        document.getElementById('lobbyView').classList.remove('hidden');
      } catch (e) {
        err.textContent = e.message;
      }
    }

    async function play() {
      var err = document.getElementById('lobbyError');
      err.textContent = '';
      try {
        var res = await fetch('/sessions/launch', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + state.token,
          },
          body: JSON.stringify({}),
        });
        var data = await res.json();
        if (!res.ok) throw new Error((data.error && data.error.message) || 'Launch failed');
        state.gameOrigin = new URL(data.gameUrl).origin;
        document.getElementById('gameFrame').src = data.gameUrl;
        document.getElementById('frameWrap').classList.remove('hidden');
      } catch (e) {
        err.textContent = e.message;
      }
    }

    // Parent side of the postMessage channel — validate origin before trusting.
    window.addEventListener('message', function (event) {
      if (!state.gameOrigin || event.origin !== state.gameOrigin) return;
      var msg = event.data || {};
      if (msg.type === 'crashpilot:balanceChanged' && state.player) {
        if (typeof msg.balance === 'number') state.player.balance = msg.balance;
        if (msg.currency) state.player.currency = msg.currency;
        renderPlayer();
      } else if (msg.type === 'crashpilot:sessionEnded') {
        document.getElementById('frameWrap').classList.add('hidden');
        document.getElementById('gameFrame').src = 'about:blank';
      }
    });

    document.getElementById('loginBtn').addEventListener('click', login);
    document.getElementById('playBtn').addEventListener('click', play);
  </script>
</body>
</html>`;
