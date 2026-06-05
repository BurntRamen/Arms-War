const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = process.env.SMOKE_PORT || "4183";
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FACTIONS = ["rumin", "sheen", "frumo", "bizi"];
const DATA_FILE = path.join(os.tmpdir(), `arms-war-smoke-${Date.now()}.json`);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(path, body = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(`${path} failed: ${data.error || response.statusText}`);
  }
  return data;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await post("/api/health");
      return;
    } catch (error) {
      await delay(100);
    }
  }
  throw new Error("Smoke test server did not start.");
}

async function state(code, token) {
  return (await post("/api/state", { code, token })).room;
}

async function getViewer(code, player) {
  const room = await state(code, player.token);
  return { room, me: room.players[player.seat] };
}

async function finishSharedDeckAction(code, players) {
  for (const player of players) {
    const { room, me } = await getViewer(code, player);
    if (room.phase !== "craft" && room.phase !== "burn") return room;
    if (me.peek?.length) {
      await post("/api/choose-peek", { code, token: player.token, cardId: me.peek[0].id });
    }
  }
  return state(code, players[0].token);
}

async function findFight(code, players) {
  for (let turn = 0; turn < 80; turn += 1) {
    let room = await state(code, players[0].token);
    if (room.phase === "fightBet") return room;
    if (room.phase !== "turnStart") {
      if (room.phase === "craft" || room.phase === "burn") {
        room = await finishSharedDeckAction(code, players);
      } else {
        throw new Error(`Unexpected phase while looking for a fight: ${room.phase}`);
      }
      if (room.phase === "fightBet") return room;
    }

    const active = players.find((player) => player.seat === room.activePlayer);
    room = (await post("/api/roll-action", { code, token: active.token })).room;
    const choice = room.actionChoices.includes("fight") ? "fight" : room.actionChoices[0];
    room = (await post("/api/select-action", { code, token: active.token, action: choice })).room;
    if (room.phase === "fightBet") return room;
    if (room.phase === "craft" || room.phase === "burn") {
      await finishSharedDeckAction(code, players);
    }
  }
  throw new Error("Could not find a fight within 80 turns.");
}

async function placeFightCards(code, player) {
  let { room, me } = await getViewer(code, player);
  for (let lane = 0; lane < 3; lane += 1) {
    const cardId = me.fightCards[0]?.id;
    if (!cardId) throw new Error(`Player ${player.seat} has no fight card for lane ${lane + 1}.`);
    room = (await post("/api/place-fight-card", { code, token: player.token, lane, cardId })).room;
    me = room.players[player.seat];
  }
  return room;
}

async function testAccounts() {
  const suffix = Date.now().toString(36);
  const oneName = `SmokeAcctA${suffix}`;
  const twoName = `SmokeAcctB${suffix}`;
  const one = await post("/api/register", { name: oneName, password: "testpass1" });
  const two = await post("/api/register", { name: twoName, password: "testpass2" });
  if (!one.accountToken || !two.accountToken) throw new Error("Account registration did not return tokens.");

  const befriended = await post("/api/add-friend", {
    accountToken: one.accountToken,
    friendName: twoName
  });
  if (!befriended.profile.friends.includes(twoName)) throw new Error("Friend was not added to the saved account.");

  await post("/api/send-message", {
    accountToken: one.accountToken,
    to: twoName,
    text: "Smoke test message"
  });
  const inbox = await post("/api/social", { accountToken: two.accountToken });
  if (!inbox.messages.some((message) => message.from === oneName && message.text === "Smoke test message")) {
    throw new Error("Friend message was not visible to the recipient.");
  }
}

async function run() {
  await testAccounts();

  const created = await post("/api/create", { name: "Smoke One" });
  const code = created.room.code;
  const players = [{ name: "Smoke One", token: created.token, seat: created.room.you }];

  for (const name of ["Smoke Two", "Smoke Three", "Smoke Four"]) {
    const joined = await post("/api/join", { code, name });
    players.push({ name, token: joined.token, seat: joined.room.you });
  }

  for (const [index, player] of players.entries()) {
    await post("/api/select-faction", { code, token: player.token, factionId: FACTIONS[index] });
  }
  for (const player of players) {
    await post("/api/start", { code, token: player.token });
  }

  let room = await findFight(code, players);
  const firstViewerRoom = await state(code, players[0].token);
  if (!firstViewerRoom.players[players[0].seat].fightCards.length) {
    throw new Error("Viewer could not see their own fight hand.");
  }
  const visibleOpponentHand = players
    .filter((player) => player.seat !== players[0].seat)
    .some((player) => firstViewerRoom.players[player.seat].fightCards.length);
  if (visibleOpponentHand) {
    throw new Error("Viewer could see an opponent fight hand before showdown.");
  }
  const active = players.find((player) => player.seat === room.activePlayer);
  const responders = players.filter((player) => player.seat !== active.seat);

  await post("/api/bet", { code, token: active.token, betAction: "bet", amount: 1 });
  await post("/api/bet", { code, token: responders[0].token, betAction: "bet", amount: 3 });
  await post("/api/bet", { code, token: responders[1].token, betAction: "concede" });
  await post("/api/bet", { code, token: responders[2].token, betAction: "bet", amount: 3 });
  room = (await post("/api/bet", { code, token: active.token, betAction: "bet", amount: 3 })).room;

  if (room.phase !== "fightPlace") {
    throw new Error(`Expected fightPlace after matched wagers, got ${room.phase}.`);
  }
  if (!room.players[responders[1].seat].fightConceded) {
    throw new Error("Conceding player was not marked as conceded.");
  }

  const remaining = players.filter((player) => player.seat !== responders[1].seat);
  for (const player of remaining) {
    room = await placeFightCards(code, player);
  }
  if (room.phase !== "fightAbility") {
    throw new Error(`Expected fightAbility after cards were placed, got ${room.phase}.`);
  }

  for (const player of remaining) {
    room = (await post("/api/pass-commander", { code, token: player.token })).room;
  }
  if (room.phase !== "fightResults") {
    throw new Error(`Expected fightResults after commander passes, got ${room.phase}.`);
  }
  if (!room.fight?.results?.lanes?.length) {
    throw new Error("Fight results did not include lane details.");
  }

  for (const player of remaining) {
    room = (await post("/api/ack-results", { code, token: player.token })).room;
  }
  if (room.phase !== "turnStart" && room.phase !== "gameOver") {
    throw new Error(`Expected the fight to finish, got ${room.phase}.`);
  }

  console.log(`Smoke test passed: ${code} reached ${room.phase} with ${players.length} players.`);
}

async function main() {
  try {
    fs.rmSync(DATA_FILE, { force: true });
  } catch (error) {
  }
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT, ARMS_WAR_DATA_FILE: DATA_FILE },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();
    await run();
  } finally {
    child.kill();
  }

  if (stderr.trim()) {
    console.warn(stderr.trim());
  }
  try {
    fs.rmSync(DATA_FILE, { force: true });
  } catch (error) {
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
