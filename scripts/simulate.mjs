// 참가자 봇 시뮬레이터: 방을 만들고 N명을 입장시킨 뒤 전체 게임을 차례로 끝까지 진행해 점수를 검증합니다.
// 사용: pnpm simulate --players=40 --teams=5 --url=http://127.0.0.1:8797 --password=local-admin [--games=tap,race]
import { readFileSync } from "node:fs";
import { memoryPattern, question, reflexDelay, secretNumber } from "../src/game/engine.ts";

const options = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith("--")).map(arg => {
  const [key, value] = arg.slice(2).split("=");
  return [key, value ?? "true"];
}));
const base = options.url ?? "http://127.0.0.1:8797";
const playerCount = Number(options.players ?? 40);
const solo = options.mode === "solo";
const teamCount = solo ? 0 : Number(options.teams ?? 5);
const catalog = JSON.parse(readFileSync(new URL("../src/content/games.json", import.meta.url), "utf8"));
const wanted = options.games?.split(",");
const games = catalog.games.filter(game => !wanted || wanted.includes(game.id));
const wsUrl = code => `${base.replace(/^http/, "ws")}/api/rooms/${code}/ws`;

function connect(code, onMessage) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl(code));
    socket.onopen = () => resolve(socket);
    socket.onerror = () => reject(new Error("socket failed"));
    socket.onmessage = event => onMessage(JSON.parse(event.data));
  });
}
const send = (socket, message) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(message));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, message) => { if (!ok) throw new Error(message); };

const created = await fetch(`${base}/api/rooms`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: options.password ?? "local-admin" }) });
assert(created.status === 201, `방 생성 실패: ${created.status}`);
const { code, adminToken, screenKey } = await created.json();
console.log(`방 ${code} · 참가자 ${playerCount}명 · ${solo ? "개인전" : `${teamCount}개 조`}`);

// --idle-wait=초: 아무 활동 없이 기다리면 방이 스스로 닫히는지 봅니다(서버의 ROOM_IDLE_MINUTES를 짧게 두고 실행).
if (options["idle-wait"]) {
  const received = [];
  const watcher = await connect(code, message => received.push(message));
  send(watcher, { t: "admin", token: adminToken });
  await sleep(Number(options["idle-wait"]) * 1000);
  assert(received.some(message => message.t === "error" && message.code === "CLOSED"), "미사용 방이 닫히지 않음");
  assert(watcher.readyState !== WebSocket.OPEN, "닫힌 뒤에도 연결이 유지됨");
  const rooms = (await (await fetch(`${base}/api/dashboard`, { method: "POST", body: JSON.stringify({ password: options.password ?? "local-admin" }) })).json()).rooms;
  assert(!rooms.some(room => room.code === code), "닫힌 방이 대시보드에 남음");
  console.log("통과: 미사용 방 자동 종료");
  process.exit(0);
}

const rejected = await fetch(`${base}/api/rooms`, { method: "POST", body: JSON.stringify({ password: "wrong" }) });
assert(rejected.status === 401, "잘못된 비밀번호가 통과됨");

let stage = null;
let adminInfo = null;
const waiters = [];
const notify = () => { for (const waiter of [...waiters]) if (waiter.test()) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(); } };
const until = (test, label, ms = 130000) => new Promise((resolve, reject) => {
  if (test()) return resolve();
  const waiter = { test, resolve };
  waiters.push(waiter);
  setTimeout(() => reject(new Error(`시간 초과: ${label} (현재 ${stage?.phase})`)), ms);
});
let stageBytes = 0;
const admin = await connect(code, message => {
  if (message.t === "stage") { stage = message.stage; stageBytes = JSON.stringify(message).length; notify(); }
  if (message.t === "admin") { adminInfo = message; notify(); }
});
send(admin, { t: "admin", token: adminToken });
await until(() => stage && adminInfo, "관리자 연결");
assert(adminInfo.screenKey === screenKey, "화면 키 불일치");

// 입장 코드 전에는 들어올 수 없어야 합니다.
const probeMessages = [];
const probe = await connect(code, message => probeMessages.push(message));
send(probe, { t: "enter", entryCode: "1234" });
await sleep(300);
assert(probeMessages.at(-1)?.code === "NOT_READY", "설정 전에 입장이 허용됨");
assert(!probeMessages.some(message => message.t === "stage"), "입장 전 소켓이 방 상태를 받음");

const teamNames = Array.from({ length: teamCount }, (_, i) => `${i + 1}조`);
// 관리자 설정: 방 이름, 사용할 게임, 게임별 시간(첫 게임만 20초로 변경).
const customDuration = { [games[0].id]: 20 };
const setup = { t: "setup", title: "봇 테스트", entryCode: "1234", teams: teamNames, gameIds: games.map(game => game.id), durations: customDuration };
send(admin, { ...setup, mode: solo ? "solo" : "team" });
await until(() => stage.title === "봇 테스트" && stage.teams.length === teamCount, "방 설정");
assert(stage.mode === (solo ? "solo" : "team") && stage.gameIds.length === games.length, "방 설정이 저장되지 않음");

// 공개 방 목록에는 코드와 이름만 있어야 합니다(비밀번호 없이 열리는 주소).
const publicList = await (await fetch(`${base}/api/public/rooms`)).json();
assert(publicList.rooms.every(room => Object.keys(room).sort().join() === "code,title"), "공개 목록에 다른 정보가 포함됨");

const dashboard = async password => fetch(`${base}/api/dashboard`, { method: "POST", body: JSON.stringify({ password }) });
assert((await dashboard("wrong")).status === 401, "대시보드가 잘못된 비밀번호를 통과시킴");
const listed = async () => (await (await dashboard(options.password ?? "local-admin")).json()).rooms.find(room => room.code === code);
await sleep(300);
assert((await listed())?.title === "봇 테스트", "대시보드에 방이 보이지 않음");

send(probe, { t: "enter", entryCode: "0000" });
await sleep(200);
assert(probeMessages.at(-1)?.code === "BAD_ENTRY_CODE", "틀린 코드가 통과됨");
send(probe, { t: "enter", entryCode: "1234" });
await sleep(200);
assert(probeMessages.at(-1)?.t === "entered" && probeMessages.at(-1).teams.length === teamCount && probeMessages.at(-1).mode === stage.mode, "조 목록을 받지 못함");
probe.close();

const clock = { offset: 0 };
const bots = [];
for (let i = 0; i < playerCount; i++) {
  const bot = { i, personal: null, token: null, stage: null, error: null };
  bot.socket = await connect(code, message => {
    if (message.t === "joined") { bot.token = message.token; bot.personal = message.personal; }
    if (message.t === "personal") bot.personal = message.personal;
    if (message.t === "stage") { bot.stage = message.stage; clock.offset = Math.max(clock.offset, message.now - Date.now()); }
    if (message.t === "error") bot.error = message;
  });
  send(bot.socket, { t: "join", entryCode: "1234", teamId: solo ? "" : stage.teams[i % teamCount].id, name: `이름${i}`, nickname: `봇${i}` });
  bots.push(bot);
}
await until(() => stage.playerCount === playerCount, "전원 입장", 60000);
console.log(`전원 입장 완료, 큰 화면 메시지 크기 ${stageBytes}바이트`);

const dup = await connect(code, () => {});
const dupMessages = [];
dup.onmessage = event => dupMessages.push(JSON.parse(event.data));
send(dup, { t: "join", entryCode: "1234", teamId: solo ? "" : stage.teams[0].id, name: "중복", nickname: "봇0" });
await sleep(200);
assert(dupMessages.at(-1)?.code === "NICKNAME_TAKEN", "중복 닉네임이 통과됨");
dup.close();

// 참가자가 들어온 뒤에는 진행 방식을 바꿀 수 없어야 합니다.
send(admin, { ...setup, mode: solo ? "team" : "solo", teams: solo ? ["1조"] : [] });
await sleep(300);
assert(stage.mode === (solo ? "solo" : "team"), "입장 후 진행 방식이 바뀜");

// 재접속: 같은 토큰으로 돌아오면 인원이 늘지 않아야 합니다.
const returning = bots[0];
returning.socket.close();
await sleep(200);
returning.socket = await connect(code, message => {
  if (message.t === "personal") returning.personal = message.personal;
  if (message.t === "stage") returning.stage = message.stage;
});
send(returning.socket, { t: "resume", token: returning.token });
await until(() => returning.personal && stage.playerCount === playerCount, "재접속");

const now = () => Date.now() + clock.offset;
// 봇 하나의 게임 행동. skill이 낮을수록 느립니다. 실제 폰처럼 0.5초마다 묶어 보냅니다.
function playBot(bot, def, seed, startedAt, endsAt) {
  const skill = 0.5 + ((bot.i * 37) % 100) / 200;
  const buffer = [];
  const push = input => buffer.push({ at: now(), input });
  const flush = setInterval(() => { if (buffer.length) send(bot.socket, { t: "input", inputs: buffer.splice(0, 40) }); }, 500);
  let index = 0;
  let value = 0;
  let foot = "L";
  const step = setInterval(() => {
    if (now() >= endsAt) return;
    switch (def.kind) {
      case "counter": push({ type: "count", n: 1 }); break;
      case "race": foot = foot === "L" ? "R" : "L"; push({ type: "foot", foot }); break;
      case "gauge": push({ type: "gauge", ms: 100 * skill }); break;
      case "quiz":
        if (def.goal && index >= def.goal) break;
        push({ type: "answer", index, choice: question(def.id, seed, index).answer });
        index += 1;
        break;
      case "memory":
        if (index >= Math.max(2, Math.round(skill * 8))) { push({ type: "memory", index, cells: [] }); break; }
        push({ type: "memory", index, cells: memoryPattern(seed, index) });
        index += 1;
        break;
      case "updown":
        value += 1;
        if (value <= 100) push({ type: "guess", value: bot.i % 7 === 0 ? secretNumber(seed) : value });
        break;
    }
  }, def.kind === "reflex" ? 100000 : Math.round(120 / skill));
  if (def.kind === "reflex") setTimeout(() => push({ type: "reflex", ms: bot.i % 11 === 0 ? 10 : 150 + (bot.i % 200) }), Math.max(0, startedAt + reflexDelay(seed, bot.personal.playerId) - now()));
  return () => { clearInterval(flush); clearInterval(step); };
}

send(admin, { t: "openSelect" });
await until(() => stage.phase === "select", "게임 선택");

// 사용하지 않기로 한 게임은 고를 수 없어야 합니다(일부 게임만 돌릴 때 검사).
const unused = catalog.games.find(game => !games.includes(game));
if (unused) {
  send(admin, { t: "pick", gameId: unused.id });
  await sleep(300);
  assert(stage.phase === "select", "제외한 게임이 선택됨");
}

const expected = new Map(stage.teams.map(team => [team.id, 0]));
// 같은 게임을 다시 고를 수 있는지 보려고 첫 게임을 마지막에 한 번 더 합니다.
const sequence = [...games, games[0]];
for (const def of sequence) {
  send(admin, { t: "pick", gameId: def.id });
  await until(() => stage.phase === "rules" && stage.gameId === def.id, `${def.id} 룰`);
  send(admin, { t: "start" });
  await until(() => stage.phase === "playing", `${def.id} 시작`);
  if (customDuration[def.id]) assert(stage.phaseEndsAt - stage.startedAt === customDuration[def.id] * 1000, `${def.id}: 설정한 시간이 적용되지 않음`);
  const started = Date.now();
  // 시연 시간을 줄이려고 제한 시간이 긴 게임은 6초 뒤 관리자가 끝냅니다(순간 포착은 끝까지).
  const stoppers = bots.map(bot => playBot(bot, def, stage.seed, stage.startedAt, stage.phaseEndsAt));
  const limit = def.kind === "reflex" ? 13000 : 6000;
  const endEarly = setTimeout(() => send(admin, { t: "endGame" }), limit);
  await until(() => stage.phase === "result", `${def.id} 종료`);
  clearTimeout(endEarly);
  stoppers.forEach(stopBot => stopBot());
  const ranking = stage.teamRanking;
  assert(ranking.length === teamCount, `${def.id}: 조 순위 수`);
  assert(ranking.every((row, i) => i === 0 || ranking[i - 1].average >= row.average), `${def.id}: 평균 정렬 오류`);
  assert(ranking.every(row => row.points === ([10, 7, 5][row.rank - 1] ?? 1)), `${def.id}: 순위별 점수(10·7·5·1)가 아님`);
  for (const row of ranking) expected.set(row.teamId, expected.get(row.teamId) + row.points);
  assert(stage.teams.every(team => team.score === expected.get(team.id)), `${def.id}: 누적 점수 불일치`);
  assert(stage.top.length > 0 && stage.top.length <= 10, `${def.id}: 상위 목록`);
  const best = ranking[0];
  console.log(`${def.id.padEnd(10)} ${String(Date.now() - started).padStart(6)}ms  1등 ${best ? `${stage.teams.find(team => team.id === best.teamId).name}(평균 ${best.average.toFixed(1)})` : "개인전"}  MVP ${stage.top[0].nickname} ${stage.top[0].label}  화면메시지 ${stageBytes}B`);
  send(admin, { t: "openSelect" });
  await until(() => stage.phase === "select", "다음 선택");
}
assert(stage.played.length === sequence.length, "진행 게임 수");
await until(() => adminInfo.rounds.length === sequence.length, "관리자 통계");
assert(adminInfo.rounds.every((round, i) => round.round === i + 1 && round.gameId === sequence[i].id && round.teamRanking.length === teamCount), "라운드 통계 오류");
assert(stage.played.every(entry => entry.mvps.length > 0), "전광판 개인 1등 누락");
await sleep(300);
assert((await listed())?.rounds === sequence.length, "대시보드 라운드 수 불일치");

// 개인 누적 순위: 전광판 TOP 10이 관리자 전체 점수와 맞아야 합니다.
const byScore = adminInfo.players.toSorted((a, b) => b.score - a.score);
assert(stage.leaders.length === Math.min(10, playerCount), "개인 순위 수");
assert(stage.leaders.every((leader, i) => leader.score === byScore[i].score && (i === 0 || stage.leaders[i - 1].score >= leader.score)), "개인 순위가 점수와 다름");
assert(stage.leaders[0].rank === 1 && byScore[0].score > 0, "개인 1등 없음");

// 행사장 화면 탭: 관리자가 순위로 바꿀 수 있고, 게임을 시작하면 진행으로 돌아옵니다.
send(admin, { t: "screenTab", tab: "ranking" });
await until(() => stage.screenTab === "ranking", "순위 탭 전환");
send(admin, { t: "openSelect" });
await until(() => stage.phase === "select", "탭 확인용 선택");
send(admin, { t: "pick", gameId: games[0].id });
await until(() => stage.phase === "rules", "탭 확인용 룰");
send(admin, { t: "start" });
await until(() => stage.screenTab === "progress" && stage.phase === "countdown", "시작 시 진행 탭 복귀");
send(admin, { t: "screenTab", tab: "ranking" });
await sleep(300);
assert(stage.screenTab === "progress", "게임 중 순위 탭으로 바뀜");
await until(() => stage.phase === "playing", "탭 확인용 시작");
send(admin, { t: "endGame" });
await until(() => stage.phase === "result", "탭 확인용 종료");

// 결과 화면에서 같은 게임을 바로 다시 고를 수 있습니다.
send(admin, { t: "pick", gameId: games[0].id });
await until(() => stage.phase === "rules" && stage.gameId === games[0].id, "결과에서 같은 게임 재선택");
assert(stage.teamRanking.length === 0 && stage.top.length === 0, "재선택 후 지난 판 결과가 남아 있음");
send(admin, { t: "openSelect" });
await until(() => stage.phase === "select", "재선택 후 게임 선택");

// 상품 후보 표시
send(admin, { t: "prize", playerId: byScore[0].id, on: true });
await until(() => adminInfo.players.find(player => player.id === byScore[0].id).prize, "상품 후보 표시");
send(admin, { t: "finish" });
await until(() => stage.phase === "final", "최종 발표");

// 최종 발표 뒤에도 점수를 유지한 채 게임을 더 할 수 있습니다.
const roundsAtFinal = stage.played.length;
const scoresAtFinal = JSON.stringify(stage.teams.map(team => team.score));
send(admin, { t: "openSelect" });
await until(() => stage.phase === "select", "최종 발표 후 게임 선택");
assert(stage.played.length === roundsAtFinal && JSON.stringify(stage.teams.map(team => team.score)) === scoresAtFinal, "최종 발표 후 점수가 바뀜");
for (const bot of bots) bot.socket.close();
console.log("통과: 입장·조·재접속·전 게임·중복 선택·점수 합계·개인 순위 검증 완료");
if (!solo) console.log("조 순위:", stage.teams.toSorted((a, b) => b.score - a.score).slice(0, 5).map(team => `${team.name} ${team.score}점`).join(", "));
console.log("개인 순위:", stage.leaders.slice(0, 5).map(leader => `${leader.rank}. ${leader.nickname} ${leader.score}점`).join(", "));

// 점수 초기화: 점수·기록만 지우고 참가자와 설정은 남습니다. 그 뒤 같은 게임을 또 할 수 있습니다.
send(admin, { t: "resetScores" });
await until(() => stage.played.length === 0 && stage.phase === "select" && adminInfo.rounds.length === 0, "점수 초기화");
assert(stage.leaders.length === 0 && stage.teams.every(team => team.score === 0), "점수가 남아 있음");
assert(adminInfo.players.length === playerCount && adminInfo.players.every(player => player.score === 0 && !player.prize), "참가자 점수가 남아 있음");
assert(stage.title === "봇 테스트" && adminInfo.entryCode === "1234", "초기화 때 설정이 지워짐");
send(admin, { t: "pick", gameId: games[0].id });
await until(() => stage.phase === "rules", "초기화 후 게임 선택");
console.log("통과: 점수 초기화");

// --keep이 없으면 방을 닫아 수동 종료를 검사하고 목록을 비웁니다.
if (!options.keep) {
  let adminClosed = false;
  admin.addEventListener("close", () => { adminClosed = true; });
  const closed = await fetch(`${base}/api/rooms/${code}/close`, { method: "POST", body: JSON.stringify({ password: options.password ?? "local-admin" }) });
  assert(closed.ok, "방 닫기 실패");
  await sleep(500);
  assert(adminClosed, "닫은 방의 연결이 끊기지 않음");
  assert(!(await listed()), "닫은 방이 대시보드에 남음");
  console.log("통과: 방 닫기");
}
admin.close();
process.exit(0);
