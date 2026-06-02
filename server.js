const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, "public");
const STARTING_GOLD = 10;
const MAX_FIGHT_BET = 5;
const MAX_PLAYERS = 4;
const SOCIAL_DATA_FILE = process.env.ARMS_WAR_DATA_FILE || "";

const rooms = new Map();
const profiles = new Map();
const messages = [];
const roomStreams = new Map();

const FACTIONS = {
  rumin: {
    id: "rumin",
    name: "Rumin",
    commander: {
      name: "Kaiser, the Jewel",
      image: "/assets/factions/rumin-commander.jpg",
      text: "Once per fight, target card you control gets +X until end of turn, where X is half the top card of your main deck, rounded down."
    },
    city: {
      name: "Rumie, City of the Empire",
      image: "/assets/factions/rumin-city.jpg",
      text: "Your cards of the same suit get +2 as long as you have 2 or more cards of that suit."
    }
  },
  sheen: {
    id: "sheen",
    name: "Sheen",
    commander: {
      name: "Munchu, the Eye",
      image: "/assets/factions/sheen-commander.jpg",
      text: "Once per fight, target card in play gets -X until end of turn, where X is half the top card of your main deck, rounded down."
    },
    city: {
      name: "Beli, Living City",
      image: "/assets/factions/sheen-city.jpg",
      text: "When you have initiative, your cards with value 10 or higher get +2 until end of turn."
    }
  },
  frumo: {
    id: "frumo",
    name: "Frumo",
    commander: {
      name: "Lord Captain Polea",
      image: "/assets/factions/frumo-commander.jpg",
      text: "Once per fight, swap two different cards you control. Cards that switched lanes this way get +1 until end of turn."
    },
    city: {
      name: "Ristus, Sunken City",
      image: "/assets/factions/frumo-city.jpg",
      text: "Your consecutive cards get +2."
    }
  },
  bizi: {
    id: "bizi",
    name: "Bizi",
    commander: {
      name: "Focus, Conductor of Progress",
      image: "/assets/factions/bizi-commander.jpg",
      text: "Whenever you play a card, put an acceleration counter on Focus. Remove an acceleration counter to give a card +1 base value."
    },
    city: {
      name: "Constanti, Technology Hub",
      image: "/assets/factions/bizi-city.jpg",
      text: "Your cards get +2 as long as they are three different suits."
    }
  }
};

function id(prefix = "") {
  return `${prefix}${crypto.randomBytes(5).toString("hex")}`;
}

function normalizeName(name) {
  return String(name || "Guest").trim().slice(0, 24) || "Guest";
}

function profileKey(name) {
  return normalizeName(name).toLowerCase();
}

function getProfile(name) {
  const displayName = normalizeName(name);
  const key = profileKey(displayName);
  if (!profiles.has(key)) {
    profiles.set(key, {
      name: displayName,
      wins: 0,
      games: 0,
      friends: new Set()
    });
  }
  const profile = profiles.get(key);
  if (profile.name !== displayName) profile.name = displayName;
  return profile;
}

function serializeProfile(profile) {
  return {
    name: profile.name,
    wins: profile.wins,
    games: profile.games,
    friends: [...profile.friends].map((friendKey) => profiles.get(friendKey)?.name || friendKey)
  };
}

function loadSocialData() {
  if (!SOCIAL_DATA_FILE) return;
  try {
    if (!fs.existsSync(SOCIAL_DATA_FILE)) return;
    const saved = JSON.parse(fs.readFileSync(SOCIAL_DATA_FILE, "utf8"));
    for (const item of saved.profiles || []) {
      const profile = {
        name: normalizeName(item.name),
        wins: Number(item.wins) || 0,
        games: Number(item.games) || 0,
        friends: new Set((item.friends || []).map(profileKey))
      };
      profiles.set(profileKey(profile.name), profile);
    }
    for (const message of saved.messages || []) {
      if (!message.from || !message.to || !message.text) continue;
      messages.push({
        id: String(message.id || id("msg_")),
        from: normalizeName(message.from),
        to: normalizeName(message.to),
        text: String(message.text).slice(0, 240),
        sentAt: message.sentAt || new Date().toISOString()
      });
    }
    while (messages.length > 300) messages.shift();
    console.log(`Loaded Arms War social data from ${SOCIAL_DATA_FILE}`);
  } catch (error) {
    console.warn(`Could not load Arms War social data: ${error.message}`);
  }
}

function saveSocialData() {
  if (!SOCIAL_DATA_FILE) return;
  try {
    fs.mkdirSync(path.dirname(SOCIAL_DATA_FILE), { recursive: true });
    const payload = {
      profiles: [...profiles.values()].map((profile) => ({
        name: profile.name,
        wins: profile.wins,
        games: profile.games,
        friends: [...profile.friends]
      })),
      messages
    };
    fs.writeFileSync(SOCIAL_DATA_FILE, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.warn(`Could not save Arms War social data: ${error.message}`);
  }
}

function getLeaderboard() {
  return [...profiles.values()]
    .map((profile) => ({
      name: profile.name,
      wins: profile.wins,
      games: profile.games,
      winRate: profile.games ? Math.round((profile.wins / profile.games) * 100) : 0
    }))
    .sort((a, b) => b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name))
    .slice(0, 12);
}

function recordGameResult(room, winnerSeat) {
  if (room.resultRecorded) return;
  room.resultRecorded = true;
  for (const player of livePlayers(room)) {
    const profile = getProfile(player.name);
    profile.games += 1;
    if (player.seat === winnerSeat) profile.wins += 1;
  }
  saveSocialData();
}

function getSocialPayload(name) {
  const profile = getProfile(name);
  const ownKey = profileKey(profile.name);
  const friendKeys = new Set(profile.friends);
  return {
    profile: serializeProfile(profile),
    leaderboard: getLeaderboard(),
    messages: messages
      .filter((message) => {
        const fromKey = profileKey(message.from);
        const toKey = profileKey(message.to);
        return fromKey === ownKey || toKey === ownKey || friendKeys.has(fromKey) || friendKeys.has(toKey);
      })
      .slice(-40)
  };
}

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function createDeck() {
  const suits = ["S", "H", "D", "C"];
  const ranks = [
    ["2", 2],
    ["3", 3],
    ["4", 4],
    ["5", 5],
    ["6", 6],
    ["7", 7],
    ["8", 8],
    ["9", 9],
    ["10", 10],
    ["J", 11],
    ["Q", 12],
    ["K", 13],
    ["A", 14]
  ];
  return shuffle(
    suits.flatMap((suit) =>
      ranks.map(([rank, value]) => ({
        id: id("card_"),
        suit,
        rank,
        value,
        name: `${rank}${suit}`
      }))
    )
  );
}

function createPlayer(seat, name) {
  const deck = createDeck();
  const playerName = normalizeName(name || `Player ${seat}`);
  getProfile(playerName);
  return {
    seat,
    name: playerName,
    token: id("tok_"),
    connected: true,
    factionId: null,
    accelerationCounters: 0,
    mainDeck: deck.slice(0, 26),
    sideDeck: deck.slice(26),
    gold: STARTING_GOLD,
    technologies: 0,
    peek: null,
    fightCards: [],
    fightLanes: [null, null, null],
    commanderUsed: false,
    commanderPassed: false,
    fightConceded: false,
    agreedBet: 0,
    readyToStart: false
  };
}

function createRoom(name) {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();
  const room = {
    code,
    players: Object.fromEntries(Array.from({ length: MAX_PLAYERS }, (_, index) => [index + 1, index === 0 ? createPlayer(1, name) : null])),
    spectators: new Set(),
    phase: "lobby",
    turn: 0,
    activePlayer: 1,
    startingRolls: null,
    actionRoll: null,
    actionChoices: [],
    selectedAction: null,
    pending: {},
    fight: null,
    winner: null,
    resultRecorded: false,
    notice: "Room created.",
    noticeId: 1,
    message: "Room created. Waiting for players.",
    log: ["Room created."],
    version: 1
  };
  rooms.set(code, room);
  return room;
}

function bumpRoom(room) {
  room.version = (room.version || 1) + 1;
}

function roomStreamSet(code) {
  if (!roomStreams.has(code)) roomStreams.set(code, new Set());
  return roomStreams.get(code);
}

function sendRoomStream(client, room) {
  client.res.write("event: state\n");
  client.res.write(`data: ${JSON.stringify({ room: sanitize(room, client.token) })}\n\n`);
}

function notifyRoom(room) {
  if (!room) return;
  bumpRoom(room);
  const clients = roomStreams.get(room.code);
  if (!clients) return;
  for (const client of [...clients]) {
    try {
      sendRoomStream(client, room);
    } catch (error) {
      clients.delete(client);
    }
  }
}

function handleRoomStream(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const code = String(requestUrl.searchParams.get("code") || "").toUpperCase();
  const token = requestUrl.searchParams.get("token") || "";
  const room = rooms.get(code);
  if (!room) {
    sendJson(res, 404, { error: "Room not found." });
    return;
  }

  const player = getPlayer(room, token);
  if (player) player.connected = true;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 1500\n\n");

  const client = { res, token };
  roomStreamSet(code).add(client);
  sendRoomStream(client, room);
  notifyRoom(room);

  const heartbeat = setInterval(() => {
    res.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    roomStreams.get(code)?.delete(client);
    if (player) {
      player.connected = false;
      notifyRoom(room);
    }
  });
}

function getPlayer(room, token) {
  return Object.values(room.players).find((p) => p && p.token === token) || null;
}

function seatNumbers() {
  return Array.from({ length: MAX_PLAYERS }, (_, index) => index + 1);
}

function livePlayers(room) {
  return seatNumbers().map((seat) => room.players[seat]).filter(Boolean);
}

function emptySeat(room) {
  return seatNumbers().find((seat) => !room.players[seat]) || null;
}

function nextSeat(room, seat) {
  const players = livePlayers(room);
  if (players.length === 0) return 1;
  const seats = players.map((player) => player.seat).sort((a, b) => a - b);
  return seats.find((candidate) => candidate > seat) || seats[0];
}

function actionOptions(roll) {
  return {
    1: ["event", "fight"],
    2: ["burn", "craft"],
    3: ["craft", "fight"],
    4: ["burn", "fight"],
    5: ["waygate", "event"],
    6: ["waygate", "fight"]
  }[roll] || [];
}

function cardLabel(card) {
  return card ? card.name : "No card";
}

function getFaction(player) {
  return FACTIONS[player?.factionId] || null;
}

function log(room, text) {
  room.log.unshift(text);
  room.log = room.log.slice(0, 80);
  room.message = text;
}

function announce(room, text) {
  log(room, text);
  room.notice = text;
  room.noticeId = (room.noticeId || 0) + 1;
}

function drawTop(deck, count) {
  return deck.splice(0, count);
}

function putBottom(deck, cards) {
  deck.push(...cards.filter(Boolean));
}

function resetTemporaryChoices(room) {
  for (const player of livePlayers(room)) {
    player.peek = null;
    player.fightCards = [];
    player.fightLanes = [null, null, null];
    player.commanderUsed = false;
    player.commanderPassed = false;
    player.fightConceded = false;
    player.agreedBet = 0;
    player.resultsAcknowledged = false;
  }
  room.pending = {};
  room.fight = null;
}

function startGame(room) {
  const players = livePlayers(room);
  if (players.length < 2) {
    throw new Error("At least two players must join first.");
  }
  if (players.some((player) => !player.factionId)) {
    throw new Error("All joined players must choose a faction first.");
  }
  if (players.some((player) => !player.readyToStart)) {
    throw new Error("All joined players must press Start Game first.");
  }
  room.startingRolls = Object.fromEntries(players.map((player) => [player.seat, rollDie()]));
  const highestRoll = Math.max(...Object.values(room.startingRolls));
  const firstSeat = players.find((player) => room.startingRolls[player.seat] === highestRoll).seat;
  room.activePlayer = firstSeat;
  room.turn = 1;
  room.phase = "turnStart";
  log(room, `${players.map((player) => `Player ${player.seat} rolled ${room.startingRolls[player.seat]}`).join(", ")}. Player ${room.activePlayer} goes first.`);
}

function nextTurn(room) {
  resetTemporaryChoices(room);
  room.activePlayer = nextSeat(room, room.activePlayer);
  room.turn += 1;
  room.phase = "turnStart";
  room.actionRoll = null;
  room.actionChoices = [];
  room.selectedAction = null;
  log(room, `Turn ${room.turn}. Player ${room.activePlayer} is active.`);
}

function checkWaygate(room, seat) {
  const player = room.players[seat];
  const opponents = livePlayers(room).filter((candidate) => candidate.seat !== seat);
  if (player.technologies >= 3 && opponents.every((opponent) => player.gold > opponent.gold)) {
    room.phase = "gameOver";
    room.winner = seat;
    recordGameResult(room, seat);
    announce(room, `${player.name} opened the Waygate with ${player.technologies} technologies and the most gold.`);
    return true;
  }
  log(room, `${player.name} triggered the Waygate, but does not yet have 3 technologies and more gold than everyone else.`);
  return false;
}

function startActionRoll(room) {
  resetTemporaryChoices(room);
  room.actionRoll = rollDie();
  room.actionChoices = actionOptions(room.actionRoll);
  room.phase = "chooseAction";
  log(room, `Player ${room.activePlayer} rolled ${room.actionRoll}: choose ${room.actionChoices.join(" or ")}.`);
}

function beginCraft(room) {
  room.phase = "craft";
  room.selectedAction = "craft";
  for (const player of livePlayers(room)) {
    player.peek = drawTop(player.sideDeck, Math.min(3, player.sideDeck.length));
    room.pending[player.seat] = true;
  }
  log(room, "Craft started. Each player chooses one side-deck card for the top of their main deck.");
}

function beginBurn(room) {
  room.phase = "burn";
  room.selectedAction = "burn";
  for (const player of livePlayers(room)) {
    player.peek = drawTop(player.mainDeck, Math.min(3, player.mainDeck.length));
    room.pending[player.seat] = true;
  }
  log(room, "Burn started. Each player chooses one main-deck card for the bottom of their side deck.");
}

function completeSharedDeckAction(room) {
  if (Object.keys(room.pending).length === 0) nextTurn(room);
}

function choosePeekCard(room, player, cardId) {
  const chosenIndex = player.peek.findIndex((card) => card.id === cardId);
  if (chosenIndex < 0) throw new Error("Choose one of your revealed cards.");
  const [chosen] = player.peek.splice(chosenIndex, 1);

  if (room.phase === "craft") {
    player.mainDeck.unshift(chosen);
    putBottom(player.sideDeck, player.peek);
    log(room, `${player.name} finished crafting.`);
  } else if (room.phase === "burn") {
    player.sideDeck.push(chosen);
    putBottom(player.mainDeck, player.peek);
    log(room, `${player.name} finished burning.`);
  } else {
    throw new Error("No craft or burn choice is pending.");
  }

  player.peek = null;
  delete room.pending[player.seat];
  completeSharedDeckAction(room);
}

function findRank(player, rank) {
  let index = player.mainDeck.findIndex((card) => card.rank === rank);
  if (index >= 0) {
    const [card] = player.mainDeck.splice(index, 1);
    player.mainDeck.unshift(card);
    return card;
  }
  index = player.sideDeck.findIndex((card) => card.rank === rank);
  if (index >= 0) {
    const [card] = player.sideDeck.splice(index, 1);
    player.mainDeck.unshift(card);
    return card;
  }
  return null;
}

function splitGold(room, winners, pot) {
  const share = Math.floor(pot / winners.length);
  let remainder = pot % winners.length;
  winners.forEach((seat) => {
    room.players[seat].gold += share;
  });
  while (remainder > 0) {
    const reveals = winners.map((seat) => ({ seat, card: room.players[seat].mainDeck.shift() })).filter((r) => r.card);
    if (reveals.length === 0) break;
    const high = Math.max(...reveals.map((r) => r.card.value));
    const best = reveals.filter((r) => r.card.value === high);
    if (best.length === 1) {
      room.players[best[0].seat].gold += remainder;
      remainder = 0;
    } else {
      winners = best.map((r) => r.seat);
    }
    reveals.forEach((r) => {
      if (r.card) room.players[r.seat].sideDeck.push(r.card);
    });
  }
}

function eventWager(room) {
  let pot = 0;
  const reveals = [];
  for (const player of livePlayers(room)) {
    if (player.gold > 0) {
      player.gold -= 1;
      pot += 1;
    }
    const card = player.mainDeck.shift();
    if (card) {
      reveals.push({ seat: player.seat, card });
      player.sideDeck.push(card);
    }
  }
  if (reveals.length === 0 || pot === 0) return "No wager could be resolved.";
  const high = Math.max(...reveals.map((r) => r.card.value));
  const winners = reveals.filter((r) => r.card.value === high).map((r) => r.seat);
  splitGold(room, winners, pot);
  return `Wager reveals: ${reveals.map((r) => `P${r.seat} ${cardLabel(r.card)}`).join(", ")}. ${winners.map((s) => room.players[s].name).join(" and ")} won the pot.`;
}

function resolveEvent(room, forcedRoll) {
  const roll = forcedRoll || rollDie();
  let detail = "";
  if (roll === 1) {
    for (const player of livePlayers(room)) putBottom(player.sideDeck, drawTop(player.mainDeck, 2));
    detail = "Each player moved the top two main-deck cards to the bottom of their side deck.";
  } else if (roll === 2) {
    detail = livePlayers(room)
      .map((player) => `${player.name} found ${cardLabel(findRank(player, "2"))}`)
      .join(". ");
  } else if (roll === 3) {
    detail = eventWager(room);
  } else if (roll === 4) {
    for (const player of livePlayers(room)) player.mainDeck.unshift(...drawTop(player.sideDeck, 2));
    detail = "Each player moved the top two side-deck cards onto their main deck.";
  } else if (roll === 5) {
    detail = livePlayers(room)
      .map((player) => `${player.name} found ${cardLabel(findRank(player, "K"))}`)
      .join(". ");
  } else if (roll === 6) {
    const won = checkWaygate(room, room.activePlayer);
    if (won) return;
    detail = "Waygate event checked the active player.";
  }
  const summary = `Event roll ${roll}. ${detail}`;
  announce(room, summary);
  if (room.phase !== "gameOver") {
    nextTurn(room);
    room.notice = summary;
    room.noticeId = (room.noticeId || 0) + 1;
  }
}

function beginFight(room) {
  const active = room.players[room.activePlayer];
  if (active.gold <= 0) throw new Error("The active player needs at least 1 gold to start a fight.");
  if (active.gold < 1) throw new Error("The active player needs enough gold to open the fight.");
  room.phase = "fightBet";
  room.selectedAction = "fight";
  room.fight = {
    bettor: room.activePlayer,
    currentBet: 1,
    maxBet: MAX_FIGHT_BET,
    lastRaiser: room.activePlayer,
    pot: 0,
    opened: false,
    resolved: false,
    paymentTrail: [],
    results: null
  };
  for (const player of livePlayers(room)) {
    player.fightCards = drawTop(player.mainDeck, Math.min(3, player.mainDeck.length));
    player.fightLanes = [null, null, null];
    player.commanderUsed = false;
    player.commanderPassed = false;
    player.fightConceded = false;
    player.agreedBet = 0;
    player.resultsAcknowledged = false;
  }
  log(room, `Fight started. Player ${room.activePlayer} must open the wager.`);
}

function placeFightCard(room, player, lane, cardId) {
  if (room.phase !== "fightPlace") throw new Error("Cards cannot be placed yet.");
  if (lane < 0 || lane > 2) throw new Error("Choose lane 1, 2, or 3.");
  if (player.fightLanes[lane]) throw new Error("That lane already has a card.");
  const index = player.fightCards.findIndex((card) => card.id === cardId);
  if (index < 0) throw new Error("Choose one of your fight cards.");
  const [card] = player.fightCards.splice(index, 1);
  player.fightLanes[lane] = card;
  if (player.factionId === "bizi") {
    player.accelerationCounters += 1;
  }
  log(room, `${player.name} placed a fight card in lane ${lane + 1}.`);
  if (livePlayers(room).every((p) => p.fightConceded || p.fightLanes.every(Boolean))) {
    room.phase = "fightAbility";
    log(room, "All fight cards are placed. Use a commander ability or pass.");
  }
}

function betFight(room, player, action, amount) {
  if (room.phase !== "fightBet") throw new Error("No fight bet is pending.");
  if (player.fightConceded) throw new Error("You already conceded this fight.");
  if (action === "concede") {
    if (!room.fight.opened) throw new Error("Wait for the active fighter to open the wager.");
    if (player.agreedBet === room.fight.currentBet) throw new Error("You already matched the current wager.");
    player.fightConceded = true;
    recordFightPayment(room, player, {
      type: "concede",
      label: `${player.name} conceded instead of matching the fight wager.`
    });
    log(room, `${player.name} conceded the fight.`);
  } else {
    const bet = Number(amount);
    if (!Number.isInteger(bet)) throw new Error("Choose a whole number of gold.");
    if (!room.fight.opened && player.seat !== room.activePlayer) {
      throw new Error("Wait for the active fighter to open the wager.");
    }
    if (bet < room.fight.currentBet) throw new Error(`You must agree to at least ${room.fight.currentBet} gold.`);
    if (bet > MAX_FIGHT_BET) throw new Error(`Fight wagers cannot be more than ${MAX_FIGHT_BET} gold.`);
    if (bet > player.gold) throw new Error("You do not have that much gold.");
    if (bet > room.fight.currentBet) {
      room.fight.currentBet = bet;
      room.fight.lastRaiser = player.seat;
      for (const p of livePlayers(room)) p.agreedBet = p.fightConceded ? p.agreedBet : 0;
      recordFightPayment(room, player, {
        type: "wager",
        amount: bet,
        label: `${player.name} raised the fight wager to ${bet} gold.`
      });
      log(room, `${player.name} raised the fight to ${bet} gold.`);
    }
    room.fight.opened = true;
    player.agreedBet = bet;
    recordFightPayment(room, player, {
      type: "wager",
      amount: bet,
      label: `${player.name} committed ${bet} gold to the fight.`
    });
    log(room, `${player.name} agreed to ${bet} gold.`);
  }

  const activePlayers = livePlayers(room).filter((p) => !p.fightConceded);
  if (activePlayers.length === 1) {
    activePlayers[0].technologies += 1;
    const summary = `${activePlayers[0].name} wins the fight by concession and gains a technology.`;
    announce(room, summary);
    nextTurn(room);
    room.notice = summary;
    room.noticeId = (room.noticeId || 0) + 1;
    return;
  }
  if (activePlayers.every((p) => p.agreedBet === room.fight.currentBet)) {
    for (const p of activePlayers) {
      p.gold -= room.fight.currentBet;
      room.fight.pot += room.fight.currentBet;
    }
    recordFightPayment(room, room.players[room.activePlayer], {
      type: "pot",
      amount: room.fight.pot,
      label: `The fight pot is locked at ${room.fight.pot} gold.`
    });
    room.phase = "fightPlace";
    log(room, `Bets are locked at ${room.fight.currentBet}. Place one card in each lane.`);
  }
}

function drawCommanderPower(player) {
  const reveal = player.mainDeck.shift();
  if (!reveal) return { amount: 0, reveal: null };
  player.sideDeck.push(reveal);
  return { amount: Math.floor(reveal.value / 2), reveal };
}

function getLaneCard(room, seat, lane) {
  const player = room.players[seat];
  if (!player || lane < 0 || lane > 2) return null;
  return player.fightLanes[lane] || null;
}

function addTempBuff(card, amount) {
  if (!card) return;
  card.tempBuff = (card.tempBuff || 0) + amount;
}

function recordFightPayment(room, player, entry) {
  if (!room.fight) return;
  room.fight.paymentTrail = room.fight.paymentTrail || [];
  room.fight.paymentTrail.push({
    id: id("pay_"),
    seat: player.seat,
    playerName: player.name,
    ...entry
  });
}

function useCommanderAbility(room, player, body) {
  if (room.phase !== "fightAbility") throw new Error("Commander abilities can only be used after fight cards are placed.");
  if (player.commanderUsed) throw new Error("You already used your commander this fight.");
  if (player.commanderPassed) throw new Error("You already passed your commander ability.");

  if (player.factionId === "rumin") {
    const lane = Number(body.lane);
    const target = getLaneCard(room, player.seat, lane);
    if (!target) throw new Error("Choose one of your cards in play.");
    const power = drawCommanderPower(player);
    addTempBuff(target, power.amount);
    player.commanderUsed = true;
    recordFightPayment(room, player, {
      type: "commander",
      ability: "Kaiser, the Jewel",
      card: power.reveal,
      amount: power.amount,
      lane,
      label: `${player.name} revealed ${cardLabel(power.reveal)} to give lane ${lane + 1} +${power.amount}.`
    });
    log(room, `${player.name} used Kaiser on lane ${lane + 1}, revealing ${cardLabel(power.reveal)} for +${power.amount}.`);
  } else if (player.factionId === "sheen") {
    const targetSeat = Number(body.targetSeat);
    const lane = Number(body.lane);
    const target = getLaneCard(room, targetSeat, lane);
    if (!target) throw new Error("Choose a card in play.");
    const power = drawCommanderPower(player);
    addTempBuff(target, -power.amount);
    player.commanderUsed = true;
    recordFightPayment(room, player, {
      type: "commander",
      ability: "Munchu, the Eye",
      card: power.reveal,
      amount: -power.amount,
      lane,
      targetSeat,
      label: `${player.name} revealed ${cardLabel(power.reveal)} to give Player ${targetSeat} lane ${lane + 1} -${power.amount}.`
    });
    log(room, `${player.name} used Emperor Nu on Player ${targetSeat} lane ${lane + 1}, revealing ${cardLabel(power.reveal)} for -${power.amount}.`);
  } else if (player.factionId === "frumo") {
    const laneA = Number(body.laneA);
    const laneB = Number(body.laneB);
    if (laneA === laneB || laneA < 0 || laneA > 2 || laneB < 0 || laneB > 2) throw new Error("Choose two different lanes.");
    if (!player.fightLanes[laneA] || !player.fightLanes[laneB]) throw new Error("Both lanes need your cards.");
    [player.fightLanes[laneA], player.fightLanes[laneB]] = [player.fightLanes[laneB], player.fightLanes[laneA]];
    addTempBuff(player.fightLanes[laneA], 1);
    addTempBuff(player.fightLanes[laneB], 1);
    player.commanderUsed = true;
    recordFightPayment(room, player, {
      type: "commander",
      ability: "Lord Captain Polea",
      laneA,
      laneB,
      label: `${player.name} swapped lanes ${laneA + 1} and ${laneB + 1}; both cards gained +1.`
    });
    log(room, `${player.name} used Lord Commander Polea to swap lanes ${laneA + 1} and ${laneB + 1}. Both cards get +1.`);
  } else if (player.factionId === "bizi") {
    const lane = Number(body.lane);
    const target = getLaneCard(room, player.seat, lane);
    if (!target) throw new Error("Choose one of your cards in play.");
    if (player.accelerationCounters <= 0) throw new Error("Focus has no acceleration counters.");
    player.accelerationCounters -= 1;
    target.value += 1;
    target.name = `${target.rank}${target.suit}`;
    player.commanderUsed = true;
    recordFightPayment(room, player, {
      type: "commander",
      ability: "Focus, Conductor of Progress",
      amount: 1,
      lane,
      label: `${player.name} spent 1 acceleration counter to improve lane ${lane + 1}.`
    });
    log(room, `${player.name} used Focus on lane ${lane + 1}. That card gets +1 base value.`);
  } else {
    throw new Error("Choose a faction before using a commander.");
  }

  finishCommanderWindow(room);
}

function passCommanderAbility(room, player) {
  if (room.phase !== "fightAbility") throw new Error("No commander ability is pending.");
  player.commanderPassed = true;
  log(room, `${player.name} passed their commander ability.`);
  finishCommanderWindow(room);
}

function finishCommanderWindow(room) {
  const participants = livePlayers(room).filter((player) => !player.fightConceded);
  if (participants.every((player) => player.commanderUsed || player.commanderPassed)) {
    prepareFightResults(room);
  }
}

function cityBonus(room, player, lane) {
  const faction = getFaction(player);
  const card = player.fightLanes[lane];
  if (!faction || !card) return { amount: 0, notes: [] };
  const cards = player.fightLanes.filter(Boolean);
  let amount = 0;
  const notes = [];

  if (faction.id === "rumin") {
    const sameSuitCount = cards.filter((c) => c.suit === card.suit).length;
    if (sameSuitCount >= 2) {
      amount += 2;
      notes.push("Rumi +2");
    }
  }

  if (faction.id === "sheen" && room.activePlayer === player.seat && card.value >= 10) {
    amount += 2;
    notes.push("Beli +2");
  }

  if (faction.id === "frumo") {
    const hasConsecutive = cards.some((other) => other.id !== card.id && Math.abs(other.value - card.value) === 1);
    if (hasConsecutive) {
      amount += 2;
      notes.push("Ristus +2");
    }
  }

  if (faction.id === "bizi") {
    const suits = new Set(cards.map((c) => c.suit));
    if (cards.length === 3 && suits.size === 3) {
      amount += 2;
      notes.push("Constanti +2");
    }
  }

  return { amount, notes };
}

function effectiveFightCard(room, player, lane) {
  const card = player.fightLanes[lane];
  if (!card) return null;
  const city = cityBonus(room, player, lane);
  return {
    card,
    value: card.value + (card.tempBuff || 0) + city.amount,
    notes: [...city.notes, card.tempBuff ? `Commander ${card.tempBuff > 0 ? "+" : ""}${card.tempBuff}` : null].filter(Boolean)
  };
}

function prepareFightResults(room) {
  const participants = livePlayers(room).filter((p) => !p.fightConceded);
  const laneWins = Object.fromEntries(participants.map((p) => [p.seat, 0]));
  const lanes = [];
  for (let lane = 0; lane < 3; lane += 1) {
    const cards = participants
      .map((p) => {
        const effective = effectiveFightCard(room, p, lane);
        return effective ? { seat: p.seat, ...effective } : null;
      })
      .filter(Boolean);
    const high = Math.max(...cards.map((x) => x.value));
    const winners = cards.filter((x) => x.value === high);
    winners.forEach((x) => {
      laneWins[x.seat] += 1 / winners.length;
    });
    lanes.push({
      lane,
      high,
      winners: winners.map((x) => x.seat),
      cards: cards.map((x) => ({
        seat: x.seat,
        card: x.card,
        value: x.value,
        notes: x.notes
      }))
    });
  }
  const best = Math.max(...Object.values(laneWins));
  const winners = Object.entries(laneWins).filter(([, wins]) => wins === best).map(([seat]) => Number(seat));
  room.fight.results = {
    lanes,
    laneWins,
    winners,
    summary: `${winners.map((seat) => room.players[seat].name).join(" and ")} won the fight.`
  };
  room.phase = "fightResults";
  for (const player of participants) player.resultsAcknowledged = false;
  announce(room, "Fight results are ready. Review the lanes, then all remaining players must proceed.");
}

function finalizeFightResults(room) {
  if (!room.fight?.results) throw new Error("Fight results are not ready.");
  const participants = livePlayers(room).filter((p) => !p.fightConceded);
  const winners = room.fight.results.winners;
  const laneNotes = room.fight.results.lanes.map((lane) =>
    `Lane ${lane.lane + 1}: ${lane.cards.map((x) => `P${x.seat} ${cardLabel(x.card)} (${x.value}${x.notes.length ? `; ${x.notes.join(", ")}` : ""})`).join(" vs ")}`
  );
  splitGold(room, winners, room.fight.pot);
  for (const player of participants) {
    player.fightLanes.forEach((card) => {
      if (card) card.tempBuff = 0;
    });
    putBottom(player.sideDeck, player.fightLanes);
  }
  for (const seat of winners) {
    const player = room.players[seat];
    if (player.technologies >= 3) {
      resolveEvent(room);
      return;
    }
    player.technologies += 1;
  }
  const summary = `${laneNotes.join(" | ")}. ${winners.map((seat) => room.players[seat].name).join(" and ")} won the fight and gained technology.`;
  announce(room, summary);
  nextTurn(room);
  room.notice = summary;
  room.noticeId = (room.noticeId || 0) + 1;
}

function acknowledgeFightResults(room, player) {
  if (room.phase !== "fightResults") throw new Error("There are no fight results to acknowledge.");
  player.resultsAcknowledged = true;
  log(room, `${player.name} is ready to leave the fight results.`);
  const participants = livePlayers(room).filter((p) => !p.fightConceded);
  if (participants.every((p) => p.resultsAcknowledged)) {
    finalizeFightResults(room);
  }
}

function selectAction(room, player, action) {
  if (room.phase !== "chooseAction") throw new Error("Roll the action die first.");
  if (player.seat !== room.activePlayer) throw new Error("Only the active player chooses the action.");
  if (!room.actionChoices.includes(action)) throw new Error("That action is not available from this roll.");
  if (action === "craft") beginCraft(room);
  if (action === "burn") beginBurn(room);
  if (action === "event") resolveEvent(room);
  if (action === "fight") beginFight(room);
  if (action === "waygate") {
    if (!checkWaygate(room, player.seat)) nextTurn(room);
  }
}

function sanitize(room, token) {
  const viewer = getPlayer(room, token);
  return {
    code: room.code,
    version: room.version || 1,
    factions: Object.values(FACTIONS),
    phase: room.phase,
    turn: room.turn,
    activePlayer: room.activePlayer,
    startingRolls: room.startingRolls,
    actionRoll: room.actionRoll,
    actionChoices: room.actionChoices,
    selectedAction: room.selectedAction,
    fight: room.fight,
    winner: room.winner,
    notice: room.notice,
    noticeId: room.noticeId || 0,
    message: room.message,
    log: room.log,
    maxPlayers: MAX_PLAYERS,
    you: viewer ? viewer.seat : null,
    players: Object.fromEntries(
      seatNumbers().map((seat) => {
        const player = room.players[seat];
        if (!player) return [seat, null];
        const isViewer = viewer && viewer.seat === seat;
        return [
          seat,
          {
            seat,
            name: player.name,
            connected: player.connected,
            factionId: player.factionId,
            faction: getFaction(player),
            accelerationCounters: player.accelerationCounters,
            gold: player.gold,
            technologies: player.technologies,
            mainDeckCount: player.mainDeck.length,
            sideDeckCount: player.sideDeck.length,
            peek: isViewer ? player.peek : player.peek ? player.peek.map(() => null) : null,
            fightCards: player.fightCards,
            fightLanes: player.fightLanes.map((card) => {
              if (room.phase === "fightPlace" && card && !isViewer) return { hidden: true };
              return card;
            }),
            commanderUsed: player.commanderUsed,
            commanderPassed: player.commanderPassed,
            fightConceded: player.fightConceded,
            agreedBet: player.agreedBet,
            resultsAcknowledged: player.resultsAcknowledged,
            readyToStart: player.readyToStart
          }
        ];
      })
    )
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function serveStatic(req, res) {
  const requested = req.url === "/" ? "/index.html" : decodeURIComponent(req.url);
  const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath);
    const types = {
      ".css": "text/css",
      ".html": "text/html",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".js": "text/javascript",
      ".json": "application/json",
      ".m4a": "audio/mp4",
      ".mp3": "audio/mpeg",
      ".ogg": "audio/ogg",
      ".svg": "image/svg+xml"
    };
    const type = types[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

async function handleApi(req, res) {
  try {
    const body = await readBody(req);
    if (req.url === "/api/health" && req.method === "POST") {
      return sendJson(res, 200, { ok: true, name: "Arms War", rooms: rooms.size });
    }
    if (req.url === "/api/social" && req.method === "POST") {
      return sendJson(res, 200, getSocialPayload(body.name));
    }
    if (req.url === "/api/add-friend" && req.method === "POST") {
      const profile = getProfile(body.name);
      const friend = getProfile(body.friendName);
      if (profileKey(profile.name) === profileKey(friend.name)) throw new Error("You cannot add yourself.");
      profile.friends.add(profileKey(friend.name));
      friend.friends.add(profileKey(profile.name));
      saveSocialData();
      return sendJson(res, 200, getSocialPayload(profile.name));
    }
    if (req.url === "/api/send-message" && req.method === "POST") {
      const from = getProfile(body.name);
      const to = getProfile(body.to);
      const text = String(body.text || "").trim().slice(0, 240);
      if (!text) throw new Error("Write a message first.");
      messages.push({
        id: id("msg_"),
        from: from.name,
        to: to.name,
        text,
        sentAt: new Date().toISOString()
      });
      while (messages.length > 300) messages.shift();
      saveSocialData();
      return sendJson(res, 200, getSocialPayload(from.name));
    }
    if (req.url === "/api/create" && req.method === "POST") {
      const room = createRoom(body.name);
      return sendJson(res, 200, { room: sanitize(room, room.players[1].token), token: room.players[1].token });
    }
    if (req.url === "/api/join" && req.method === "POST") {
      const room = rooms.get(String(body.code || "").toUpperCase());
      if (!room) throw new Error("Room not found.");
      if (room.phase !== "lobby") throw new Error("That game already started.");
      const seat = emptySeat(room);
      if (seat) {
        room.players[seat] = createPlayer(seat, body.name);
        log(room, `${room.players[seat].name} joined the room as Player ${seat}.`);
        notifyRoom(room);
        return sendJson(res, 200, { room: sanitize(room, room.players[seat].token), token: room.players[seat].token });
      }
      throw new Error(`That table already has ${MAX_PLAYERS} players.`);
    }
    if (req.url === "/api/state" && req.method === "POST") {
      const room = rooms.get(String(body.code || "").toUpperCase());
      if (!room) throw new Error("Room not found.");
      return sendJson(res, 200, { room: sanitize(room, body.token) });
    }

    const room = rooms.get(String(body.code || "").toUpperCase());
    if (!room) throw new Error("Room not found.");
    const player = getPlayer(room, body.token);
    if (!player) throw new Error("You are spectating or your player token is missing.");

    if (req.url === "/api/start" && req.method === "POST") {
      if (livePlayers(room).length < 2) throw new Error("At least two players must join first.");
      if (room.phase !== "lobby") throw new Error("This game already started.");
      player.readyToStart = true;
      if (livePlayers(room).every((p) => p.readyToStart)) {
        startGame(room);
      } else {
        log(room, `${player.name} is ready. Waiting on the other players to start.`);
      }
    } else if (req.url === "/api/select-faction" && req.method === "POST") {
      if (room.phase !== "lobby") throw new Error("Factions can only be chosen in the lobby.");
      if (!FACTIONS[body.factionId]) throw new Error("Choose one of the available factions.");
      player.factionId = body.factionId;
      player.readyToStart = false;
      log(room, `${player.name} chose ${FACTIONS[body.factionId].name}.`);
    } else if (req.url === "/api/roll-action" && req.method === "POST") {
      if (room.phase !== "turnStart") throw new Error("It is not time to roll.");
      if (player.seat !== room.activePlayer) throw new Error("Only the active player can roll.");
      startActionRoll(room);
    } else if (req.url === "/api/select-action" && req.method === "POST") {
      selectAction(room, player, body.action);
    } else if (req.url === "/api/choose-peek" && req.method === "POST") {
      choosePeekCard(room, player, body.cardId);
    } else if (req.url === "/api/bet" && req.method === "POST") {
      betFight(room, player, body.betAction, body.amount);
    } else if (req.url === "/api/place-fight-card" && req.method === "POST") {
      placeFightCard(room, player, Number(body.lane), body.cardId);
    } else if (req.url === "/api/use-commander" && req.method === "POST") {
      useCommanderAbility(room, player, body);
    } else if (req.url === "/api/pass-commander" && req.method === "POST") {
      passCommanderAbility(room, player);
    } else if (req.url === "/api/ack-results" && req.method === "POST") {
      acknowledgeFightResults(room, player);
    } else {
      return sendJson(res, 404, { error: "Unknown endpoint." });
    }
    notifyRoom(room);
    return sendJson(res, 200, { room: sanitize(room, body.token) });
  } catch (error) {
    return sendJson(res, 400, { error: error.message });
  }
}

loadSocialData();

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/api/stream") && req.method === "GET") {
    handleRoomStream(req, res);
    return;
  }
  if (req.url.startsWith("/api/")) {
    handleApi(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Arms War running at http://localhost:${PORT}`);
});
