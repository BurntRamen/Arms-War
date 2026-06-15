const urlRoomCode = new URLSearchParams(window.location.search).get("room") || "";

const state = {
  room: null,
  token: localStorage.getItem("waygate_token") || "",
  roomCode: localStorage.getItem("waygate_code") || "",
  joinCode: urlRoomCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6),
  name: localStorage.getItem("waygate_name") || "",
  error: "",
  selectedBet: 1,
  lastNoticeId: 0,
  toast: null,
  streamConnected: false,
  social: {
    profile: null,
    leaderboard: [],
    messages: []
  },
  friendName: "",
  messageTo: "",
  messageText: "",
  accountToken: localStorage.getItem("armswar_account_token") || "",
  accountName: localStorage.getItem("armswar_account_name") || localStorage.getItem("waygate_name") || "",
  accountPassword: "",
  musicEnabled: localStorage.getItem("armswar_music_enabled") !== "false",
  showOpponentAbilities: false
};

const app = document.getElementById("app");
let audioContext = null;
let musicTimer = null;
let musicStep = 0;
let masterGain = null;
let musicAudio = null;
let activeMusicTheme = "";
let roomStream = null;
let roomStreamKey = "";

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[character]);
}

const MENU_FACTIONS = [
  {
    id: "rumin",
    name: "Rumin",
    commander: { name: "Kaiser, the Jewel", image: "/assets/factions/rumin-commander.jpg" },
    city: { name: "Rumie, City of the Empire", image: "/assets/factions/rumin-city.jpg" }
  },
  {
    id: "sheen",
    name: "Sheen",
    commander: { name: "Munchu, the Eye", image: "/assets/factions/sheen-commander.jpg" },
    city: { name: "Beli, Living City", image: "/assets/factions/sheen-city.jpg" }
  },
  {
    id: "frumo",
    name: "Frumo",
    commander: { name: "Lord Captain Polea", image: "/assets/factions/frumo-commander.jpg" },
    city: { name: "Ristus, Sunken City", image: "/assets/factions/frumo-city.jpg" }
  },
  {
    id: "bizi",
    name: "Bizi",
    commander: { name: "Focus, Conductor of Progress", image: "/assets/factions/bizi-commander.jpg" },
    city: { name: "Constanti, Technology Hub", image: "/assets/factions/bizi-city.jpg" }
  }
];

const MUSIC_THEMES = {
  neutral: {
    scale: [196, 220, 247, 294, 330, 392, 440, 494],
    bass: [98, 98, 130.81, 146.83],
    leadType: "triangle",
    accentType: "sine",
    bassType: "sawtooth",
    leadVolume: 0.14,
    bassVolume: 0.06,
    stride: 2
  },
  rumin: {
    scale: [174.61, 196, 220, 261.63, 293.66, 349.23, 392, 440],
    bass: [87.31, 98, 130.81, 146.83],
    leadType: "sawtooth",
    accentType: "triangle",
    bassType: "sawtooth",
    leadVolume: 0.13,
    bassVolume: 0.08,
    stride: 1
  },
  sheen: {
    scale: [196, 233.08, 261.63, 311.13, 349.23, 392, 466.16, 523.25],
    bass: [98, 116.54, 155.56, 174.61],
    leadType: "sine",
    accentType: "triangle",
    bassType: "triangle",
    leadVolume: 0.12,
    bassVolume: 0.045,
    stride: 3
  },
  frumo: {
    scale: [164.81, 196, 220, 246.94, 293.66, 329.63, 392, 440],
    bass: [82.41, 98, 123.47, 146.83],
    leadType: "triangle",
    accentType: "sine",
    bassType: "triangle",
    leadVolume: 0.13,
    bassVolume: 0.055,
    stride: 2
  },
  bizi: {
    scale: [185, 220, 246.94, 277.18, 329.63, 369.99, 440, 493.88],
    bass: [92.5, 110, 138.59, 164.81],
    leadType: "square",
    accentType: "sine",
    bassType: "sawtooth",
    leadVolume: 0.095,
    bassVolume: 0.055,
    stride: 4
  }
};

const MUSIC_TRACKS = {
  rumin: [
    "/assets/music/rumin-theme-1.mp3",
    "/assets/music/rumin-theme-2.mp3",
    "/assets/music/rumin-theme-3.mp3",
    "/assets/music/rumin-theme-4.mp3"
  ],
  sheen: [
    "/assets/music/sheen-theme-1.mp3",
    "/assets/music/sheen-theme-2.mp3",
    "/assets/music/sheen-theme-3.mp3",
    "/assets/music/sheen-theme-4.mp3"
  ],
  frumo: [
    "/assets/music/frumo-theme-1.mp3",
    "/assets/music/frumo-theme-2.mp3",
    "/assets/music/frumo-theme-3.mp3",
    "/assets/music/frumo-theme-4.mp3"
  ],
  bizi: [
    "/assets/music/bizi-theme-1.mp3",
    "/assets/music/bizi-theme-2.mp3",
    "/assets/music/bizi-theme-3.mp3",
    "/assets/music/bizi-theme-4.mp3"
  ]
};

function suitSymbol(suit) {
  return { S: "♠", H: "♥", D: "♦", C: "♣" }[suit] || suit;
}

function cardLabel(card) {
  if (!card || card.hidden) return "Hidden";
  return `${card.rank}${suitSymbol(card.suit)}`;
}

function cardView(card, options = {}) {
  if (!card) {
    if (options.empty) return `<div class="empty-slot">${options.label || "Empty"}</div>`;
    return `<div class="play-card back"><div class="rank">?</div><div class="suit">?</div></div>`;
  }
  if (card.hidden) return `<div class="play-card back"><div class="rank">?</div><div class="suit">?</div></div>`;
  const red = card.suit === "H" || card.suit === "D" ? " red" : "";
  const action = options.action ? ` data-action="${options.action}"` : "";
  const extra = options.extra || "";
  const buff = card.tempBuff ? `<div class="buff">${card.tempBuff > 0 ? "+" : ""}${card.tempBuff}</div>` : "";
  return `<button class="play-card${red}" data-card-id="${card.id}"${action}${extra}>
    <div class="rank">${card.rank}</div>
    ${buff}
    <div class="suit">${suitSymbol(card.suit)}</div>
  </button>`;
}

function factionCard(faction, selected) {
  return `<button class="faction-card ${selected ? "selected" : ""}" data-action="select-faction" data-faction-id="${faction.id}">
    <div class="faction-art-row">
      <img src="${faction.commander.image}" alt="${faction.commander.name}" />
      <img src="${faction.city.image}" alt="${faction.city.name}" />
    </div>
    <div class="faction-name">${faction.name}</div>
    <div class="faction-role">Commander</div>
    <strong>${faction.commander.name}</strong>
    <p>${faction.commander.text}</p>
    <div class="faction-role">City</div>
    <strong>${faction.city.name}</strong>
    <p>${faction.city.text}</p>
  </button>`;
}

function menuFactionTile(faction) {
  return `<div class="menu-faction-tile">
    <div class="menu-faction-art">
      <img src="${faction.commander.image}" alt="${faction.commander.name}" />
      <img src="${faction.city.image}" alt="${faction.city.name}" />
    </div>
    <strong>${faction.name}</strong>
  </div>`;
}

function menuStartSteps() {
  return `<section class="menu-start-steps">
    <div><span>1</span><strong>Create or Join</strong><p>Use a room code or invite link to enter a table.</p></div>
    <div><span>2</span><strong>Pick In Lobby</strong><p>Faction cards appear inside the game Action panel.</p></div>
    <div><span>3</span><strong>Ready Up</strong><p>All joined players press Start Game to begin.</p></div>
  </section>`;
}

function qrCodeCard() {
  return `<div class="menu-card qr-menu-card">
    <div class="menu-card-label">Share</div>
    <h2>Website QR Code</h2>
    <p>Scan this to open Arms War on another device.</p>
    <img class="qr-code" src="/assets/arms-war-qr-code.png" alt="QR code for the Arms War website" />
    <a class="site-link" href="https://arms-war.onrender.com" target="_blank" rel="noreferrer">arms-war.onrender.com</a>
  </div>`;
}

function musicButton() {
  return `<button class="secondary music-button" data-action="toggle-music">${state.musicEnabled ? "Turn Music Off" : "Turn Music On"}</button>`;
}

function factionThemeId() {
  const room = state.room;
  const me = room?.players?.[room.you];
  return me?.factionId || me?.faction?.id || "neutral";
}

function seatNumbers(room = state.room) {
  const count = room?.maxPlayers || 4;
  return Array.from({ length: count }, (_, index) => index + 1);
}

function joinedPlayers(room = state.room) {
  if (!room?.players) return [];
  return seatNumbers(room).map((seat) => room.players[seat]).filter(Boolean);
}

function remainingReadyPlayers(room, me) {
  return joinedPlayers(room).filter((player) => player.seat !== me.seat && !player.readyToStart);
}

function playerLabel(player) {
  if (!player) return "Open seat";
  return `P${player.seat}${player.name ? ` ${escapeHtml(player.name)}` : ""}`;
}

function listLabels(players) {
  if (!players.length) return "the other players";
  if (players.length === 1) return playerLabel(players[0]);
  return `${players.slice(0, -1).map(playerLabel).join(", ")} and ${playerLabel(players[players.length - 1])}`;
}

function pendingFightBetters(room, currentBet = room.fight?.currentBet) {
  return joinedPlayers(room).filter((player) => !player.fightConceded && player.agreedBet !== currentBet);
}

function pendingFightPlacers(room) {
  return joinedPlayers(room).filter((player) => !player.fightConceded && !player.fightLanes.every(Boolean));
}

function pendingCommanderPlayers(room) {
  return joinedPlayers(room).filter((player) => !player.fightConceded && !player.commanderUsed && !player.commanderPassed);
}

function pendingResultPlayers(room) {
  return joinedPlayers(room).filter((player) => !player.fightConceded && !player.resultsAcknowledged);
}

function ensureAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioContext.createGain();
    masterGain.gain.value = 0.38;
    masterGain.connect(audioContext.destination);
  }
  if (audioContext.state === "suspended") audioContext.resume();
}

function playTone(freq, start, duration, type = "sine", volume = 0.22) {
  if (!audioContext || !masterGain) return;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.04);
}

function scheduleMusicBar() {
  if (!state.musicEnabled || !audioContext) return;
  const now = audioContext.currentTime;
  const theme = MUSIC_THEMES[factionThemeId()] || MUSIC_THEMES.neutral;
  for (let i = 0; i < 8; i += 1) {
    const t = now + i * 0.42;
    const note = theme.scale[(musicStep + i * theme.stride) % theme.scale.length];
    playTone(note, t, 0.28, i % 3 === 0 ? theme.leadType : theme.accentType, theme.leadVolume);
    if (i % 2 === 0) {
      playTone(theme.bass[((musicStep / 8) | 0) % theme.bass.length], t, 0.38, theme.bassType, theme.bassVolume);
    }
  }
  musicStep = (musicStep + 1) % 64;
}

function startProceduralMusic() {
  ensureAudio();
  stopProceduralMusic();
  if (masterGain) {
    masterGain.gain.cancelScheduledValues(audioContext.currentTime);
    masterGain.gain.setValueAtTime(0.38, audioContext.currentTime);
  }
  scheduleMusicBar();
  musicTimer = setInterval(scheduleMusicBar, 3200);
}

function stopProceduralMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
  if (audioContext && masterGain) {
    masterGain.gain.cancelScheduledValues(audioContext.currentTime);
    masterGain.gain.setValueAtTime(0.0001, audioContext.currentTime);
  }
}

function stopMusic() {
  stopProceduralMusic();
  if (musicAudio) {
    musicAudio.pause();
    musicAudio.src = "";
    musicAudio = null;
  }
  activeMusicTheme = "";
}

function pickFactionTrack(themeId) {
  const tracks = MUSIC_TRACKS[themeId] || [];
  if (!tracks.length) return "";
  return tracks[Math.floor(Math.random() * tracks.length)];
}

function musicIsPlaying() {
  return Boolean(musicTimer || (musicAudio && !musicAudio.paused));
}

function startMusic() {
  const themeId = factionThemeId();
  const track = pickFactionTrack(themeId);
  stopMusic();
  activeMusicTheme = themeId;
  if (!track) {
    startProceduralMusic();
    return;
  }
  musicAudio = new Audio(track);
  musicAudio.volume = 0.72;
  musicAudio.loop = false;
  musicAudio.addEventListener("ended", () => {
    if (state.musicEnabled) startMusic();
  });
  musicAudio.play().catch(() => {
    if (state.musicEnabled) startProceduralMusic();
  });
}

function syncMusicTheme() {
  if (state.musicEnabled && musicIsPlaying() && activeMusicTheme !== factionThemeId()) {
    startMusic();
  }
}

function setMusicEnabled(enabled) {
  state.musicEnabled = enabled;
  localStorage.setItem("armswar_music_enabled", enabled ? "true" : "false");
  if (enabled) startMusic();
  else stopMusic();
}

function applyRoom(room) {
  if (!room) return;
  if (state.room?.code === room.code && room.version && state.room.version && room.version < state.room.version) return;
  const previousNoticeId = state.room?.noticeId || state.lastNoticeId;
  state.room = room;
  state.roomCode = room.code;
  localStorage.setItem("waygate_code", state.roomCode);
  if (room.notice && room.noticeId && room.noticeId !== previousNoticeId) {
    showToast(room.notice);
    state.lastNoticeId = room.noticeId;
  }
  syncMusicTheme();
}

function stopRoomStream() {
  if (roomStream) roomStream.close();
  roomStream = null;
  roomStreamKey = "";
  state.streamConnected = false;
}

function connectRoomStream() {
  if (!window.EventSource || !state.roomCode) return;
  const key = `${state.roomCode}:${state.token || "spectator"}`;
  if (roomStream && roomStreamKey === key) return;
  stopRoomStream();
  roomStreamKey = key;
  roomStream = new EventSource(`/api/stream?code=${encodeURIComponent(state.roomCode)}&token=${encodeURIComponent(state.token)}`);
  roomStream.addEventListener("open", () => {
    state.streamConnected = true;
    render();
  });
  roomStream.addEventListener("state", (event) => {
    const payload = JSON.parse(event.data);
    applyRoom(payload.room);
    state.streamConnected = true;
    render();
  });
  roomStream.addEventListener("error", () => {
    state.streamConnected = false;
    render();
  });
}

function roomInviteUrl(room) {
  const url = new URL(window.location.href);
  url.searchParams.set("room", room.code);
  return url.toString();
}

async function api(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error || "Request failed.");
  if (Object.prototype.hasOwnProperty.call(payload, "token")) {
    state.token = payload.token;
    if (state.token) localStorage.setItem("waygate_token", state.token);
    else localStorage.removeItem("waygate_token");
  }
  if (payload.room) {
    applyRoom(payload.room);
    connectRoomStream();
  }
  state.error = "";
  render();
  return payload;
}

async function act(path, body = {}) {
  try {
    return await api(path, { code: state.roomCode, token: state.token, ...body });
  } catch (error) {
    state.error = error.message;
    render();
    return null;
  }
}

function isEditingText() {
  const active = document.activeElement;
  if (!active) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
}

function shouldRenderAfterBackgroundUpdate(options) {
  return !options.background || !isEditingText();
}

async function socialApi(path, body = {}, options = {}) {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: state.accountName || state.name || "Guest", accountToken: state.accountToken, ...body })
    });
    const payload = await response.json();
    if (!response.ok || payload.error) throw new Error(payload.error || "Request failed.");
    if (payload.accountToken) {
      state.accountToken = payload.accountToken;
      localStorage.setItem("armswar_account_token", state.accountToken);
    }
    if (payload.profile?.name) {
      state.accountName = payload.profile.name;
      state.name = payload.profile.name;
      localStorage.setItem("armswar_account_name", state.accountName);
      localStorage.setItem("waygate_name", state.name);
    }
    state.social = payload;
    state.error = "";
    if (shouldRenderAfterBackgroundUpdate(options)) render();
    return true;
  } catch (error) {
    state.error = error.message;
    if (shouldRenderAfterBackgroundUpdate(options)) render();
    return false;
  }
}

let toastTimer = null;

function showToast(text) {
  if (!text) return;
  state.toast = { text };
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toast = null;
    if (!isEditingText()) render();
  }, 4500);
}

function clampBet(value) {
  const room = state.room;
  const me = room?.players?.[room.you];
  if (!room?.fight || !me) return 1;
  const min = room.fight.currentBet;
  const max = Math.min(room.fight.maxBet || 5, me.gold);
  return Math.max(min, Math.min(max, Number(value) || min));
}

function syncSelectedBet() {
  if (state.room?.phase !== "fightBet") return;
  state.selectedBet = clampBet(state.selectedBet);
}

function rulebookPanel() {
  return `<section class="menu-card wide-card">
    <div class="menu-card-label">Rulebook</div>
    <h2>How To Play</h2>
    <div class="rulebook-grid">
      <div><strong>Setup</strong><p>Each player gets a shuffled 52-card deck split into a 26-card main deck and 26-card side deck. Players start with 10 gold.</p></div>
      <div><strong>Turn Roll</strong><p>The active player rolls a die and chooses one of the two actions shown by that roll: Event, Fight, Burn, Craft, or Waygate.</p></div>
      <div><strong>Craft</strong><p>Each player looks at the top 3 side-deck cards, puts one on top of their main deck, and bottoms the rest.</p></div>
      <div><strong>Burn</strong><p>Each player looks at the top 3 main-deck cards, sends one to the bottom of their side deck, and bottoms the rest of the main cards.</p></div>
      <div><strong>Fight</strong><p>Players inspect 3 main-deck cards, wager up to 5 gold, then place one card into each lane. Opponent cards stay hidden during placement.</p></div>
      <div><strong>Win</strong><p>Winning a fight grants a technology. Trigger Waygate with 3 or more technologies and more gold than your opponent to win.</p></div>
    </div>
  </section>`;
}

function eventReferencePanel() {
  const events = [
    ["1", "Each player moves the top two cards of their main deck face-down to the bottom of their side deck."],
    ["2", "Each player searches their main or side deck for a 2, reveals it, and puts it on top of their main deck."],
    ["3", "Each player wagers 1 gold and reveals the top main-deck card. Highest value wins the pot; ties split or reveal again for leftovers."],
    ["4", "Each player puts the top two cards of their side deck face-down on top of their main deck."],
    ["5", "Each player searches their main or side deck for a King, reveals it, and puts it on top of their main deck."],
    ["6", "Waygate check: if you have 3 or more technologies and more gold than every other player, you win."]
  ];
  return `<section class="menu-card wide-card event-reference-card">
    <div class="menu-card-label">Event Reference</div>
    <h2>What Events Do</h2>
    <p>When a player chooses Event, an event die is rolled and every player resolves the matching result.</p>
    <div class="event-roll-grid">
      ${events.map(([roll, text]) => `<div class="event-roll"><strong>${roll}</strong><p>${text}</p></div>`).join("")}
    </div>
  </section>`;
}

function leaderboardPanel() {
  const rows = state.social.leaderboard.length
    ? state.social.leaderboard
        .map((entry, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(entry.name)}</td><td>${entry.wins}</td><td>${entry.games}</td><td>${entry.winRate}%</td></tr>`)
        .join("")
    : `<tr><td colspan="5">No completed games yet.</td></tr>`;
  return `<section class="menu-card">
    <div class="menu-card-label">Leaderboard</div>
    <h2>Top Players</h2>
    <table class="leaderboard-table">
      <thead><tr><th>#</th><th>Name</th><th>Wins</th><th>Games</th><th>Rate</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

function friendsPanel() {
  const profile = state.social.profile;
  const loggedIn = Boolean(state.accountToken && profile?.savedAccount);
  const friends = profile?.friends?.length ? profile.friends.map((name) => `<span>${escapeHtml(name)}</span>`).join("") : `<span>No friends yet</span>`;
  const messageOptions = [state.messageTo, ...(profile?.friends || [])]
    .filter(Boolean)
    .filter((name, index, list) => list.indexOf(name) === index)
    .map((name) => `<option value="${escapeHtml(name)}" ${state.messageTo === name ? "selected" : ""}>${escapeHtml(name)}</option>`)
    .join("");
  const messageRows = state.social.messages.length
    ? state.social.messages
        .slice()
        .reverse()
        .map((message) => `<div class="message-row"><strong>${escapeHtml(message.from)} to ${escapeHtml(message.to)}</strong><p>${escapeHtml(message.text)}</p></div>`)
        .join("")
    : `<div class="message-row"><p>No messages yet.</p></div>`;
  return `<section class="menu-card account-card">
    <div class="menu-card-label">Account</div>
    <h2>Friends & Messages</h2>
    <p>${loggedIn ? `Logged in as <strong>${escapeHtml(profile.name)}</strong>` : "Create or log into an account to save friends, stats, and messages."}</p>
    <div class="account-controls">
      <label>Account name<input id="accountName" value="${escapeHtml(state.accountName)}" placeholder="Player name" autocomplete="username" /></label>
      <label>Password<input id="accountPassword" value="${escapeHtml(state.accountPassword)}" type="password" placeholder="Password" autocomplete="current-password" /></label>
      <div class="row">
        <button data-action="register-account">Create Account</button>
        <button class="secondary" data-action="login-account">Log In</button>
        <button class="secondary" data-action="logout-account" ${loggedIn ? "" : "disabled"}>Log Out</button>
      </div>
    </div>
    <div class="friend-list">${friends}</div>
    <label>Add friend<input id="friendName" value="${escapeHtml(state.friendName)}" placeholder="Friend account name" autocomplete="off" ${loggedIn ? "" : "disabled"} /></label>
    <button data-action="add-friend" ${loggedIn ? "" : "disabled"}>Add Friend</button>
    <label>Message to<input id="messageTo" list="friendOptions" value="${escapeHtml(state.messageTo)}" placeholder="Friend name" autocomplete="off" ${loggedIn ? "" : "disabled"} /></label>
    <datalist id="friendOptions">${messageOptions}</datalist>
    <label>Message<input id="messageText" value="${escapeHtml(state.messageText)}" placeholder="Type a message" autocomplete="off" ${loggedIn ? "" : "disabled"} /></label>
    <button data-action="send-message" ${loggedIn ? "" : "disabled"}>Send Message</button>
    <div class="message-list">${messageRows}</div>
  </section>`;
}

function roomCodeShare(room) {
  const inviteUrl = roomInviteUrl(room);
  return `<div class="room-share">
    <span>Room Code</span>
    <input id="roomCodeCopy" value="${room.code}" readonly aria-label="Room code" />
    <button class="secondary" data-action="copy-room-code" data-code="${room.code}">Copy</button>
    <button class="secondary" data-action="copy-room-link" data-link="${inviteUrl}">Invite Link</button>
  </div>`;
}

function lobbyInvitePanel(room) {
  return `<section class="panel lobby-invite">
    <div>
      <span class="eyebrow">Invite Players</span>
      <h2>Room ${room.code}</h2>
      <p>Share this code or invite link. The match can start with 2-4 players once everyone is ready.</p>
    </div>
    ${roomCodeShare(room)}
  </section>`;
}

function lobbySeatCards(room) {
  return `<section class="lobby-seats">
    ${seatNumbers(room)
      .map((seat) => {
        const player = room.players[seat];
        const isYou = room.you === seat;
        const status = !player
          ? "Open Seat"
          : player.readyToStart
            ? "Ready"
          : player.faction
            ? "Choosing Start"
            : "Choosing Faction";
        return `<div class="seat-card ${isYou ? "you" : ""} ${player ? "occupied" : "open"}">
          <div class="seat-topline"><span>P${seat}</span><strong>${status}</strong></div>
          <h3>${player ? escapeHtml(player.name) : "Waiting for player"}</h3>
          <p>${escapeHtml(player?.faction?.name || "No faction yet")}</p>
        </div>`;
      })
      .join("")}
  </section>`;
}

function fightStepTracker(room) {
  const steps = [
    ["fightBet", "Betting"],
    ["fightPlace", "Place Cards"],
    ["fightAbility", "Abilities"],
    ["fightResults", "View Results"]
  ];
  const activeIndex = Math.max(0, steps.findIndex(([phase]) => phase === room.phase));
  return `<div class="fight-steps">
    ${steps
      .map(([phase, label], index) => `<div class="fight-step ${phase === room.phase ? "current" : ""} ${index < activeIndex ? "done" : ""}">
        <span>${index + 1}</span><strong>${label}</strong>
      </div>`)
      .join("")}
  </div>`;
}

function fightResultsSummary(room) {
  const results = room.fight?.results;
  if (!results) return "";
  const laneRows = results.lanes
    .map((lane) => {
      const cards = lane.cards.map((entry) => `P${entry.seat} ${cardLabel(entry.card)} ${entry.value}${entry.notes?.length ? ` (${entry.notes.join(", ")})` : ""}`).join(" vs ");
      return `<div><span>Lane ${lane.lane + 1}</span><strong>${lane.winners.map((seat) => `P${seat}`).join(" + ")}</strong><small>${cards}</small></div>`;
    })
    .join("");
  return `<div class="results-summary">
    <h3>Fight Results</h3>
    ${laneRows}
    <div class="result-winner"><span>Fight Winner</span><strong>${results.winners.map((seat) => `P${seat}`).join(" + ")}</strong></div>
  </div>`;
}

function opponentAbilitiesPanel(room) {
  if (!state.showOpponentAbilities) return "";
  const opponents = joinedPlayers(room).filter((player) => player.seat !== room.you && player.faction);
  if (!opponents.length) return "";
  return `<section class="opponent-abilities">
    ${opponents
      .map(
        (player) => `<article class="ability-card">
          <div class="ability-owner">P${player.seat} ${escapeHtml(player.name)} | ${escapeHtml(player.faction.name)}</div>
          <div class="ability-feature">
            <img src="${player.faction.commander.image}" alt="${player.faction.commander.name}" />
            <div><strong>${player.faction.commander.name}</strong><p>${player.faction.commander.text}</p></div>
          </div>
          <div class="ability-feature">
            <img src="${player.faction.city.image}" alt="${player.faction.city.name}" />
            <div><strong>${player.faction.city.name}</strong><p>${player.faction.city.text}</p></div>
          </div>
        </article>`
      )
      .join("")}
  </section>`;
}

function paymentTrailPanel(room) {
  const entries = room.fight?.paymentTrail || [];
  if (!entries.length) return "";
  return `<section class="payment-trail">
    <h3>Wagers & Reveals</h3>
    ${entries
      .slice(-8)
      .map((entry) => `<div class="payment-row"><strong>P${entry.seat}</strong><span>${escapeHtml(entry.label || entry.type)}</span>${entry.card ? `<em>${cardLabel(entry.card)}</em>` : ""}</div>`)
      .join("")}
  </section>`;
}

function menu() {
  return `<div class="page menu-page"><main class="shell menu-shell">
    <section class="menu-hero">
      <div class="menu-utility">${musicButton()}</div>
      <div class="menu-kicker">Main Menu</div>
      <h1 class="brand">Arms War</h1>
      <p class="subtitle">Create or join a multiplayer table. Faction selection happens after you enter the lobby.</p>
    </section>
    ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
    <section class="menu-grid">
      <div class="menu-card primary-menu-card">
        <div class="menu-card-label">Host</div>
        <h2>Create Table</h2>
        <p>Start a live match for 2-4 players, then send everyone the room code or invite link.</p>
        <label>Your name<input id="name" value="${escapeHtml(state.name)}" placeholder="Player name" autocomplete="nickname" /></label>
        <button data-action="create">Create Table</button>
      </div>
      <div class="menu-card">
        <div class="menu-card-label">Guest</div>
        <h2>Join Table</h2>
        <p>Enter an existing room code to take the next open seat. Room links fill this in automatically.</p>
        <label>Your name<input id="joinName" value="${escapeHtml(state.name)}" placeholder="Player name" autocomplete="nickname" /></label>
        <label>Room code<input id="joinCode" value="${escapeHtml(state.joinCode)}" placeholder="ABC123" maxlength="6" autocomplete="off" /></label>
        <button data-action="join">Join Table</button>
      </div>
      ${qrCodeCard()}
    </section>
    ${menuStartSteps()}
    <section class="menu-dashboard">
      ${rulebookPanel()}
      ${eventReferencePanel()}
      ${leaderboardPanel()}
      ${friendsPanel()}
    </section>
  </main></div>`;
}

function playerPanel(player) {
  if (!player) return `<div class="player open-player"><h3>Open Seat</h3><div>Invite a player before starting.</div></div>`;
  const you = state.room.you === player.seat;
  const active = state.room.activePlayer === player.seat && state.room.phase !== "lobby";
  const fightHand = you && player.fightCards?.length
    ? `<div class="mini-hand"><span>Your fight hand</span><div class="mini-cards">${player.fightCards.map((card) => cardView(card)).join("")}</div></div>`
    : "";
  return `<div class="player ${you ? "you" : ""} ${active ? "active-player" : ""} player-${player.factionId || "neutral"}">
    <h3>P${player.seat}: ${escapeHtml(player.name)}${you ? " (You)" : ""}</h3>
    <div>${escapeHtml(player.faction ? player.faction.name : "No faction")} | ${player.connected ? "Connected" : "Disconnected"}${player.readyToStart ? " | Ready" : ""}${player.fightConceded ? " | Conceded fight" : ""}</div>
    <div class="metrics">
      <div class="metric"><span>Gold</span><strong>${player.gold}</strong></div>
      <div class="metric"><span>Tech</span><strong>${player.technologies}</strong></div>
      <div class="metric"><span>Main</span><strong>${player.mainDeckCount}</strong></div>
      <div class="metric"><span>Side</span><strong>${player.sideDeckCount}</strong></div>
      <div class="metric"><span>Focus</span><strong>${player.accelerationCounters || 0}</strong></div>
    </div>
    ${fightHand}
  </div>`;
}

function controls() {
  const room = state.room;
  const me = room.players[room.you];
  if (!me) return `<p>You are spectating this room.</p>`;
  if (room.phase === "lobby") {
    const players = joinedPlayers(room);
    const waitingPlayers = remainingReadyPlayers(room, me);
    const needsMorePlayers = players.length < 2;
    const waiting = me.readyToStart && (waitingPlayers.length > 0 || needsMorePlayers);
    const waitingText = needsMorePlayers
      ? "You are ready. Waiting for at least one more player to join."
      : `You are ready. Waiting on ${waitingPlayers.map((player) => `P${player.seat}`).join(", ")} to start.`;
    return `<div class="lobby-action-callout">
        <span>Lobby Action</span>
        <strong>Pick your faction here, then press Start Game.</strong>
      </div>
      <p>${waiting ? waitingText : "Choose a faction, then press Start Game. All joined players must start."}</p>
      <div class="faction-grid">${room.factions.map((faction) => factionCard(faction, me.factionId === faction.id)).join("")}</div>`;
  }
  if (["fightBet", "fightPlace", "fightAbility", "fightResults"].includes(room.phase)) {
    const resultSummary = room.phase === "fightResults" ? fightResultsSummary(room) : "";
    return `${fightStepTracker(room)}${resultSummary}${fightControls(room, me)}`;
  }
  if (room.phase === "turnStart" && room.activePlayer === room.you) return `<button data-action="roll-action">Roll Action Die</button>`;
  if (room.phase === "turnStart") return `<p>Waiting for Player ${room.activePlayer} to roll.</p>`;
  if (room.phase === "chooseAction" && room.activePlayer === room.you) {
    return `<p>Rolled ${room.actionRoll}. Choose one:</p><div class="row">${room.actionChoices
      .map((choice) => `<button data-action="select-action" data-choice="${choice}">${choice}</button>`)
      .join("")}</div>`;
  }
  if (room.phase === "chooseAction") return `<p>Waiting for Player ${room.activePlayer} to choose ${room.actionChoices.join(" or ")}.</p>`;
  if ((room.phase === "craft" || room.phase === "burn") && me.peek) {
    return `<p>${room.phase === "craft" ? "Choose one side-deck card to place on top of your main deck." : "Choose one main-deck card to send to the bottom of your side deck."}</p>
      <div class="cards">${me.peek.map((card) => cardView(card, { action: "choose-peek" })).join("")}</div>`;
  }
  if (room.phase === "craft" || room.phase === "burn") {
    const pending = joinedPlayers(room).filter((player) => player.peek);
    return `<p>Your choice is locked. Waiting for ${listLabels(pending)}.</p>`;
  }
  if (room.phase === "gameOver") return `<h2>Player ${room.winner} wins.</h2>`;
  return `<p>Waiting for the other players.</p>`;
}

function fightControls(room, me) {
  if (room.phase === "fightBet") {
    syncSelectedBet();
    const currentBet = room.fight.currentBet;
    const activePlayers = joinedPlayers(room).filter((player) => !player.fightConceded);
    if (!room.fight.opened && room.activePlayer !== room.you) {
      return `<p>Waiting for Player ${room.activePlayer} to open the fight wager.</p>
        <h3>Your fight cards</h3>
        <div class="cards">${me.fightCards.map((card) => cardView(card)).join("")}</div>`;
    }
    const waitingOnBet = me.agreedBet === currentBet && !activePlayers.every((player) => player.agreedBet === currentBet);
    if (waitingOnBet) {
      const pending = pendingFightBetters(room, currentBet).filter((player) => player.seat !== me.seat);
      return `<p>You agreed to <strong>${currentBet}</strong> gold. Waiting for ${listLabels(pending)} to confirm or raise.</p>
        <h3>Your fight cards</h3>
        <div class="cards">${me.fightCards.map((card) => cardView(card)).join("")}</div>`;
    }
    const maxBet = Math.min(room.fight.maxBet || 5, me.gold);
    const canConfirm = state.selectedBet >= currentBet && state.selectedBet <= maxBet;
    const needsResponse = me.agreedBet !== currentBet;
    const canConcede = room.fight.opened && needsResponse;
    const confirmLabel = !room.fight.opened
      ? `Open at ${state.selectedBet}`
      : state.selectedBet === currentBet
        ? `Match ${currentBet}`
        : `Raise to ${state.selectedBet}`;
    const prompt = room.fight.opened && needsResponse
      ? `The current wager is <strong>${currentBet}</strong> gold. Match it, raise it, or concede.`
      : `Fight wagers max out at <strong>${room.fight.maxBet || 5}</strong> gold. Choose your total wager, then confirm.`;
    return `<p>${prompt}</p>
      <div class="bet-box">
        <div class="bet-readout">
          <span>Current bet</span><strong>${currentBet}</strong>
        </div>
        <div class="bet-picker">
          <button class="secondary icon-button" data-action="adjust-bet" data-delta="-1" ${state.selectedBet <= currentBet ? "disabled" : ""}>-</button>
          <div class="bet-total"><span>${needsResponse ? "Your response" : "Your wager"}</span><strong>${state.selectedBet}</strong></div>
          <button class="secondary icon-button" data-action="adjust-bet" data-delta="1" ${state.selectedBet >= maxBet ? "disabled" : ""}>+</button>
        </div>
        <button data-action="confirm-bet" ${canConfirm ? "" : "disabled"}>${confirmLabel}</button>
        <button class="danger" data-action="concede" ${canConcede ? "" : "disabled"}>Concede</button>
      </div>
      <p class="hint">You have ${me.gold} gold. The fight cap is ${room.fight.maxBet || 5}.</p>
      <h3>Your fight cards</h3>
      <div class="cards">${me.fightCards.map((card) => cardView(card)).join("")}</div>`;
  }
  if (room.phase === "fightPlace") {
    const selectedCard = me.fightCards.find((card) => card.id === selectedFightCardId);
    const pending = pendingFightPlacers(room).filter((player) => player.seat !== me.seat);
    const placedAll = me.fightLanes.every(Boolean);
    if (placedAll) return `<p>Your lanes are set. Waiting for ${listLabels(pending)} to place cards.</p>`;
    return `<p>Place one card into each lane. Cards reveal when all lanes are filled.</p>
      ${selectedCard ? `<div class="selected-card-preview"><span>Selected</span>${cardView(selectedCard)}</div>` : ""}
      <div class="cards selectable-cards">${me.fightCards.map((card) => cardView(card, { action: "select-fight-card", extra: card.id === selectedFightCardId ? ' data-selected="true"' : "" })).join("")}</div>
      <p id="selectedCardLabel">${selectedCard ? "Card selected. Choose a highlighted lane." : "Select a card, then a lane."}</p>`;
  }
  if (room.phase === "fightAbility") {
    if (me.commanderUsed || me.commanderPassed) {
      const pending = pendingCommanderPlayers(room).filter((player) => player.seat !== me.seat);
      return `<p>Waiting for ${listLabels(pending)} to use or pass commander abilities.</p>`;
    }
    if (me.factionId === "rumin") {
      return `<p>Kaiser: choose one of your lanes to buff from the top card of your main deck.</p>
        <div class="row">${[0, 1, 2].map((lane) => `<button data-action="use-commander" data-lane="${lane}">Buff lane ${lane + 1}</button>`).join("")}
        <button class="secondary" data-action="pass-commander">Pass</button></div>`;
    }
    if (me.factionId === "sheen") {
      return `<p>Emperor Nu: choose any card in play to weaken from the top card of your main deck.</p>
        <div class="row">${joinedPlayers(room).flatMap((player) => [0, 1, 2].map((lane) => `<button data-action="use-commander" data-target-seat="${player.seat}" data-lane="${lane}">P${player.seat} lane ${lane + 1}</button>`)).join("")}
        <button class="secondary" data-action="pass-commander">Pass</button></div>`;
    }
    if (me.factionId === "frumo") {
      return `<p>Polea: swap two of your lanes. Both switched cards get +1.</p>
        <div class="row">
          <select id="laneA"><option value="0">Lane 1</option><option value="1">Lane 2</option><option value="2">Lane 3</option></select>
          <select id="laneB"><option value="1">Lane 2</option><option value="0">Lane 1</option><option value="2">Lane 3</option></select>
          <button data-action="use-commander">Swap</button>
          <button class="secondary" data-action="pass-commander">Pass</button>
        </div>`;
    }
    if (me.factionId === "bizi") {
      return `<p>Focus: spend 1 acceleration counter to give one of your cards +1 base value.</p>
        <div class="row">${[0, 1, 2].map((lane) => `<button data-action="use-commander" data-lane="${lane}">Improve lane ${lane + 1}</button>`).join("")}
        <button class="secondary" data-action="pass-commander">Pass</button></div>`;
    }
  }
  if (room.phase === "fightResults") {
    if (me.resultsAcknowledged) {
      const pending = pendingResultPlayers(room).filter((player) => player.seat !== me.seat);
      return `<p>Results reviewed. Waiting for ${listLabels(pending)} to proceed.</p>`;
    }
    return `<p>Review who won each lane, then proceed to end the fight.</p>
      <button data-action="ack-results">Proceed</button>`;
  }
  return "";
}

function fightBoard() {
  const room = state.room;
  const players = joinedPlayers(room);
  const canPlaceSelected = room.phase === "fightPlace" && selectedFightCardId;
  const showFightSlots = room.phase === "fightPlace" || room.phase === "fightAbility" || room.phase === "fightResults";
  if (!showFightSlots) {
    return `<div class="lanes">${[0, 1, 2]
      .map((lane) => `<div class="lane idle-lane"><div class="lane-title">Lane ${lane + 1}</div><div class="empty-slot">No fight card</div></div>`)
      .join("")}</div>`;
  }
  return `<div class="lanes">${[0, 1, 2]
    .map(
      (lane) => `<div class="lane ${canPlaceSelected && !room.players[room.you]?.fightLanes[lane] ? "lane-target" : ""}" data-action="place-lane" data-lane="${lane}">
        <div class="lane-title">Lane ${lane + 1}</div>
        ${players
          .map((player) => {
            const card = player.fightLanes[lane];
            const isMe = room.you === player.seat;
            const hidden = room.phase === "fightPlace" && card && (!isMe || card.hidden);
            const visibleCard = hidden ? null : card;
            const resultLane = room.fight?.results?.lanes?.find((entry) => entry.lane === lane);
            const resultCard = resultLane?.cards?.find((entry) => entry.seat === player.seat);
            const wonLane = resultLane?.winners?.includes(player.seat);
            const notes = resultCard?.notes?.length ? `<small>${resultCard.notes.join(", ")}</small>` : "";
            const resultLabel = room.phase === "fightResults" && resultCard ? `<div class="lane-result ${wonLane ? "won" : ""}">${wonLane ? "Won" : "Lost"} (${resultCard.value})${notes}</div>` : "";
            return `<div class="${wonLane ? "lane-player lane-winner" : "lane-player"}"><strong>P${player.seat}</strong><div class="cards">${card ? cardView(visibleCard) : cardView(null, { empty: true, label: "Open" })}</div>${resultLabel}</div>`;
          })
          .join("")}
      </div>`
    )
    .join("")}</div>`;
}

function lobbySetupArea(room) {
  const me = room.players[room.you];
  return `<section class="lobby-setup-grid">
    <section class="panel lobby-guide-panel">
      <span class="eyebrow">Table Setup</span>
      <h2>Waiting Room</h2>
      <p>This is the setup screen. The battle lanes appear after everyone chooses a faction and the game starts.</p>
      <div class="setup-checklist">
        <div><strong>1</strong><span>Invite 2-4 players with the room link.</span></div>
        <div><strong>2</strong><span>Each player picks a faction in the panel on the right.</span></div>
        <div><strong>3</strong><span>Everyone presses Start Game when ready.</span></div>
      </div>
      <h3>Lobby Log</h3>
      <div class="log compact-log">${room.log.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
    </section>
    <aside class="panel lobby-action-panel">
      <h2>Choose Faction</h2>
      ${controls()}
      <div class="lobby-ready-bar">
        <div>
          <span>Your Status</span>
          <strong>${me?.readyToStart ? "Ready" : me?.faction ? "Faction chosen" : "Choose a faction"}</strong>
        </div>
        <button data-action="start" ${me?.readyToStart ? "disabled" : ""}>${me?.readyToStart ? "Waiting..." : "Start Game"}</button>
      </div>
    </aside>
  </section>`;
}

function lobbyScreen() {
  const room = state.room;
  return `<div class="page lobby-page theme-${factionThemeId()}"><main class="shell lobby-shell">
    ${state.toast ? `<div class="toast" data-action="dismiss-toast">${escapeHtml(state.toast.text)}</div>` : ""}
    <section class="lobby-header">
      <div>
        <span class="eyebrow">Table Lobby</span>
        <h1 class="brand">Arms War</h1>
        <p class="subtitle">Invite players, choose factions, and ready up. The battle table appears after the game starts.</p>
      </div>
      <div class="topbar-actions">
        ${musicButton()}
        <button class="secondary" data-action="toggle-opponent-abilities">${state.showOpponentAbilities ? "Hide" : "Show"} Opponent Abilities</button>
        <button class="secondary" data-action="leave">Leave</button>
      </div>
    </section>
    ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
    ${lobbyInvitePanel(room)}
    ${lobbySeatCards(room)}
    ${opponentAbilitiesPanel(room)}
    ${lobbySetupArea(room)}
  </main></div>`;
}

function game() {
  const room = state.room;
  const fightActive = ["fightBet", "fightPlace", "fightAbility", "fightResults"].includes(room.phase);
  const activePlayer = room.players[room.activePlayer];
  const turnSpotlight = room.phase !== "lobby" && activePlayer ? `<section class="turn-spotlight">
    <span>Current Turn</span><strong>Player ${activePlayer.seat}: ${escapeHtml(activePlayer.name)}</strong>
  </section>` : "";
  const playArea = `<section class="game-grid ${fightActive ? "fight-game-grid" : ""}">
      <div class="panel table-panel">
        <h2>Table</h2>
        <p class="table-message">${escapeHtml(room.message)}</p>
        ${fightBoard()}
      </div>
      <aside class="panel action-panel ${fightActive ? "fight-action-panel" : ""}">
        <h2>Action</h2>
        ${controls()}
        ${paymentTrailPanel(room)}
        <h2 style="margin-top:18px">Log</h2>
        <div class="log">${room.log.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div>
      </aside>
    </section>`;
  return `<div class="page game-page theme-${factionThemeId()} ${fightActive ? "fight-active" : ""}"><main class="shell game-shell">
    ${state.toast ? `<div class="toast" data-action="dismiss-toast">${escapeHtml(state.toast.text)}</div>` : ""}
    <section class="topbar game-topbar">
      <div>
        <h1 class="brand">Arms War</h1>
        <p class="subtitle">${room.you ? `Player ${room.you}` : "Spectator"}</p>
      </div>
      <div class="topbar-actions">
        ${musicButton()}
        <button class="secondary" data-action="toggle-opponent-abilities">${state.showOpponentAbilities ? "Hide" : "Show"} Opponent Abilities</button>
        ${room.phase === "lobby" ? "" : roomCodeShare(room)}
        <button class="secondary" data-action="leave">Leave</button>
      </div>
    </section>
    ${state.error ? `<div class="error">${escapeHtml(state.error)}</div>` : ""}
    <section class="status game-status">
      <div class="pill"><span>Turn</span><strong>${room.turn || "Lobby"}</strong></div>
      <div class="pill"><span>Phase</span><strong>${room.phase}</strong></div>
      <div class="pill"><span>Active</span><strong>P${room.activePlayer}</strong></div>
      <div class="pill"><span>Roll</span><strong>${room.actionRoll || "-"}</strong></div>
      <div class="pill"><span>Multiplayer</span><strong>${state.streamConnected ? "Live" : "Syncing"}</strong></div>
    </section>
    ${turnSpotlight}
    ${opponentAbilitiesPanel(room)}
    ${fightActive ? playArea : `<section class="players game-players">${seatNumbers(room).map((seat) => playerPanel(room.players[seat])).join("")}</section>`}
    ${fightActive ? `<section class="players game-players">${seatNumbers(room).map((seat) => playerPanel(room.players[seat])).join("")}</section>` : playArea}
  </main></div>`;
}

function render() {
  app.innerHTML = state.room ? (state.room.phase === "lobby" ? lobbyScreen() : game()) : menu();
}

let selectedFightCardId = "";

app.addEventListener("input", (event) => {
  if (event.target.id === "name" || event.target.id === "joinName") {
    state.name = event.target.value;
    localStorage.setItem("waygate_name", state.name);
  }
  if (event.target.id === "joinCode") {
    state.joinCode = event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
    event.target.value = state.joinCode;
  }
  if (event.target.id === "friendName") state.friendName = event.target.value;
  if (event.target.id === "messageTo") state.messageTo = event.target.value;
  if (event.target.id === "messageText") state.messageText = event.target.value;
  if (event.target.id === "accountName") {
    state.accountName = event.target.value;
    localStorage.setItem("armswar_account_name", state.accountName);
  }
  if (event.target.id === "accountPassword") state.accountPassword = event.target.value;
});

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  if (action === "toggle-music") {
    setMusicEnabled(!state.musicEnabled);
    showToast(state.musicEnabled ? "Music started." : "Music stopped.");
    return render();
  }
  if (action === "toggle-opponent-abilities") {
    state.showOpponentAbilities = !state.showOpponentAbilities;
    return render();
  }
  if (action === "create") return act("/api/create", { name: state.name || "Player 1" });
  if (action === "join") return act("/api/join", { code: state.joinCode, token: "", name: state.name || "Player" });
  if (action === "register-account") {
    const ok = await socialApi("/api/register", { name: state.accountName || state.name, password: state.accountPassword });
    if (!ok) return;
    state.accountPassword = "";
    showToast("Account saved.");
    return render();
  }
  if (action === "login-account") {
    const ok = await socialApi("/api/login", { name: state.accountName || state.name, password: state.accountPassword });
    if (!ok) return;
    state.accountPassword = "";
    showToast("Logged in.");
    return render();
  }
  if (action === "logout-account") {
    const ok = await socialApi("/api/logout");
    if (!ok) return;
    localStorage.removeItem("armswar_account_token");
    state.accountToken = "";
    state.accountPassword = "";
    showToast("Logged out.");
    return render();
  }
  if (action === "add-friend") {
    const friendName = state.friendName;
    state.friendName = "";
    return socialApi("/api/add-friend", { friendName });
  }
  if (action === "send-message") {
    const payload = { to: state.messageTo, text: state.messageText };
    state.messageText = "";
    return socialApi("/api/send-message", payload);
  }
  if (action === "copy-room-code") {
    const code = target.dataset.code || state.room?.code || "";
    const input = document.getElementById("roomCodeCopy");
    if (input) {
      input.focus();
      input.select();
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        document.execCommand("copy");
      }
      showToast(`Room code ${code} copied.`);
    } catch (error) {
      showToast(`Room code: ${code}`);
    }
    return render();
  }
  if (action === "copy-room-link") {
    const link = target.dataset.link || (state.room ? roomInviteUrl(state.room) : window.location.href);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        const input = document.getElementById("roomCodeCopy");
        if (input) {
          input.value = link;
          input.select();
        }
        document.execCommand("copy");
      }
      showToast("Invite link copied.");
    } catch (error) {
      showToast(link);
    }
    return render();
  }
  if (action === "leave") {
    stopRoomStream();
    state.room = null;
    state.token = "";
    state.roomCode = "";
    localStorage.removeItem("waygate_token");
    localStorage.removeItem("waygate_code");
    return render();
  }
  if (action === "start") return act("/api/start");
  if (action === "select-faction") return act("/api/select-faction", { factionId: target.dataset.factionId });
  if (action === "roll-action") return act("/api/roll-action");
  if (action === "select-action") return act("/api/select-action", { action: target.dataset.choice });
  if (action === "choose-peek") return act("/api/choose-peek", { cardId: target.dataset.cardId });
  if (action === "adjust-bet") {
    state.selectedBet = clampBet(state.selectedBet + Number(target.dataset.delta || 0));
    return render();
  }
  if (action === "confirm-bet") {
    const amount = clampBet(state.selectedBet);
    const betAction = amount > state.room.fight.currentBet ? "raise" : "agree";
    const result = await act("/api/bet", { betAction, amount });
    const room = result?.room;
    const me = room?.players?.[room.you];
    const activePlayers = room ? joinedPlayers(room).filter((player) => player && !player.fightConceded) : [];
    if (room?.phase === "fightBet" && me?.agreedBet === room.fight.currentBet && !activePlayers.every((player) => player.agreedBet === room.fight.currentBet)) {
      showToast("Bet confirmed. Waiting for the other players.");
      render();
    }
    return;
  }
  if (action === "concede") return act("/api/bet", { betAction: "concede" });
  if (action === "dismiss-toast") {
    state.toast = null;
    if (toastTimer) clearTimeout(toastTimer);
    return render();
  }
  if (action === "select-fight-card") {
    selectedFightCardId = target.dataset.cardId;
    const label = document.getElementById("selectedCardLabel");
    if (label) label.textContent = "Card selected. Choose a lane.";
    return;
  }
  if (action === "place-lane" && selectedFightCardId) {
    const cardId = selectedFightCardId;
    selectedFightCardId = "";
    return act("/api/place-fight-card", { lane: target.dataset.lane, cardId });
  }
  if (action === "use-commander") {
    const payload = {
      lane: target.dataset.lane,
      targetSeat: target.dataset.targetSeat,
      laneA: document.getElementById("laneA")?.value,
      laneB: document.getElementById("laneB")?.value
    };
    return act("/api/use-commander", payload);
  }
  if (action === "pass-commander") return act("/api/pass-commander");
  if (action === "ack-results") return act("/api/ack-results");
});

setInterval(() => {
  if (state.room && state.roomCode && !roomStream) {
    api("/api/state", { code: state.roomCode, token: state.token }).catch(() => {});
  } else if (!state.room) {
    socialApi("/api/social", {}, { background: true }).catch(() => {});
  }
}, 4000);

if (state.roomCode && state.token) {
  api("/api/state", { code: state.roomCode, token: state.token }).catch(() => {
    localStorage.removeItem("waygate_code");
    localStorage.removeItem("waygate_token");
    state.roomCode = "";
    state.token = "";
    render();
  });
} else {
  socialApi("/api/social").catch(() => render());
}

window.addEventListener(
  "pointerdown",
  () => {
    if (state.musicEnabled && !musicIsPlaying()) startMusic();
  },
  { once: true }
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
