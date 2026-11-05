import { DurableObject } from "cloudflare:workers";
import catalog from "../src/content/games.json";
import { applyInput, liveValue, newRun, rankPlayers, rankTeams, REFLEX_MAX_DELAY_MS, REFLEX_NO_RESPONSE_MS, valueLabel, type GameDef, type PlayerRank, type Run, type TeamRank } from "../src/game/engine";
import {
  clientMessage, COUNTDOWN_MS, MAX_ENTRY_ATTEMPTS, MAX_PLAYERS, rankByScore, TEAM_COLORS, withDuration,
  type ClientMessage, type ErrorCode, type GameMode, type Leader, type ScreenTab, type Personal, type Phase, type PlayedGame, type RoundRecord, type ServerMessage, type StageView, type TeamInfo, type TopPlayer,
} from "../src/game/protocol";
import type { Registry } from "./registry";

export type Env = {
  ROOMS: DurableObjectNamespace<Room>;
  REGISTRY: DurableObjectNamespace<Registry>;
  ADMIN_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
  ENVIRONMENT: string;
  ADMIN_PASSWORD?: string;
  /** 이 시간(분) 동안 관리자 조작·입장·게임 입력이 없으면 방을 닫습니다. */
  ROOM_IDLE_MINUTES?: string;
  /** 게임 기록이 있는 방의 대기 시간(분). 행사 중 쉬는 동안 점수가 지워지지 않게 더 길게 둡니다. */
  ROOM_PLAYED_IDLE_MINUTES?: string;
};

const games = catalog.games as GameDef[];
const DEFAULT_IDLE_MINUTES = 10;
const DEFAULT_PLAYED_IDLE_MINUTES = 60;
const STAGE_MS = 250;
/** 폰은 큰 화면보다 드물게(1초) 받습니다. 참가자가 많아도 전송량이 폭증하지 않게 하는 핵심입니다. */
const PLAYER_STAGE_EVERY = 4;
const SAVE_MS = 2000;
const MAX_MESSAGE_CHARS = 4096;
const MAX_ACTIONS_PER_SEC = 40;
/** 입력 시각을 믿어 주는 범위. 폰이 묶어 보내는 간격보다 넉넉해야 합니다. */
const MAX_INPUT_AGE_MS = 2000;
const TOP_COUNT = 10;
const MAX_MVPS = 5;

type TeamState = TeamInfo & { score: number };
type PlayerState = { id: string; teamId: string; name: string; nickname: string; token: string; score: number; prize?: boolean };

type RoomState = {
  code: string;
  title: string;
  mode: GameMode;
  screenTab: ScreenTab;
  leaders: Leader[];
  gameIds: string[];
  durations: Record<string, number>;
  rounds: RoundRecord[];
  createdAt: number;
  adminToken: string;
  screenKey: string;
  entryCode: string;
  phase: Phase;
  teams: TeamState[];
  players: PlayerState[];
  gameId: string | null;
  seed: number;
  phaseEndsAt: number | null;
  startedAt: number | null;
  runs: Record<string, Run>;
  teamRanking: TeamRank[];
  playerRanking: PlayerRank[];
  top: TopPlayer[];
  played: PlayedGame[];
  expiresAt: number;
};

type Attachment = { role: "admin" | "screen" | "player" | null; playerId?: string };

const randomToken = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");

export class Room extends DurableObject<Env> {
  private room: RoomState | null = null;
  private stageTimer: ReturnType<typeof setTimeout> | null = null;
  private stageTicks = 0;
  private lastSave = 0;
  // 소켓별 속도 제한과 입장 시도 횟수는 잠시 메모리에만 둡니다(깨어나면 초기화돼도 괜찮습니다).
  private limits = new WeakMap<WebSocket, { second: number; actions: number; attempts: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get<RoomState>("room");
      // 설정 항목이 생기기 전에 만든 방도 그대로 열리게 기본값을 채웁니다.
      const defaults = { title: "연말 대항전", mode: "team" as const, screenTab: "progress" as const, leaders: [], gameIds: games.map(game => game.id), durations: {}, rounds: [], createdAt: Date.now() };
      this.room = stored ? {
        ...defaults, ...stored,
        players: stored.players.map(player => ({ ...player, score: player.score ?? 0 })),
        played: stored.played.map(entry => ({ ...entry, mvps: entry.mvps ?? [] })),
      } : null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/init") {
      if (this.room) return new Response("exists", { status: 409 });
      const adminToken = randomToken();
      const screenKey = randomToken();
      this.room = {
        code: url.searchParams.get("code") ?? "", title: url.searchParams.get("title") ?? "", mode: "team", screenTab: "progress", leaders: [], gameIds: games.map(game => game.id), durations: {}, rounds: [], createdAt: Date.now(),
        adminToken, screenKey, entryCode: "", phase: "lobby", teams: [], players: [],
        gameId: null, seed: 0, phaseEndsAt: null, startedAt: null, runs: {}, teamRanking: [], playerRanking: [], top: [], played: [],
        expiresAt: Date.now() + this.idleMs(),
      };
      await this.save();
      await this.schedule();
      this.report();
      return Response.json({ adminToken, screenKey });
    }
    if (!this.room) return new Response("no room", { status: 404 });
    if (url.pathname === "/close") {
      await this.closeRoom();
      return new Response("closed");
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: null } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const room = this.room;
    if (!room || typeof raw !== "string" || raw.length > MAX_MESSAGE_CHARS) return;
    if (!this.allow(socket)) return;
    let message: ClientMessage;
    try {
      message = clientMessage.parse(JSON.parse(raw));
    } catch {
      return this.fail(socket, "BAD_MESSAGE", "잘못된 요청입니다.");
    }
    const attachment = socket.deserializeAttachment() as Attachment;

    switch (message.t) {
      case "admin":
        if (message.token !== room.adminToken) return this.fail(socket, "BAD_TOKEN", "관리자 권한이 없습니다.");
        socket.serializeAttachment({ role: "admin" } satisfies Attachment);
        this.send(socket, this.adminMessage());
        return this.send(socket, this.stageMessage());
      case "screen":
        if (message.key !== room.screenKey) return this.fail(socket, "BAD_TOKEN", "화면 주소가 올바르지 않습니다.");
        socket.serializeAttachment({ role: "screen" } satisfies Attachment);
        this.send(socket, { t: "screenOk" });
        return this.send(socket, this.stageMessage());
      case "enter":
        if (!this.checkEntry(socket, message.entryCode)) return;
        return this.send(socket, { t: "entered", mode: room.mode, teams: room.teams.map(({ id, name, color }) => ({ id, name, color })) });
      case "join":
        return this.join(socket, message);
      case "resume": {
        const player = room.players.find(entry => entry.token === message.token);
        if (!player) return this.fail(socket, "BAD_TOKEN", "다시 입장해 주세요.");
        return this.attachPlayer(socket, player);
      }
      case "input":
        if (attachment.role === "player" && attachment.playerId) this.input(attachment.playerId, message);
        return;
      case "screenTab":
        // 관리자가 원격으로 바꾸거나, 행사장 컴퓨터에서 직접 누를 수 있습니다.
        if (attachment.role !== "admin" && attachment.role !== "screen") return;
        if (room.phase === "countdown" || room.phase === "playing") return;
        room.screenTab = message.tab;
        return this.commit();
      default:
        if (attachment.role === "admin") await this.adminAction(socket, message);
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const { role } = socket.deserializeAttachment() as Attachment;
    if (role === "player") this.queueStage();
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    if (now >= room.expiresAt) return this.closeRoom();
    if (room.phaseEndsAt !== null && now >= room.phaseEndsAt) {
      if (room.phase === "countdown") this.beginPlaying(now);
      else if (room.phase === "playing") this.endGame();
      await this.commit();
    }
    await this.schedule();
  }

  private idleMs(): number {
    const played = Boolean(this.room?.played.length);
    const minutes = Number(played ? this.env.ROOM_PLAYED_IDLE_MINUTES : this.env.ROOM_IDLE_MINUTES);
    return (minutes > 0 ? minutes : played ? DEFAULT_PLAYED_IDLE_MINUTES : DEFAULT_IDLE_MINUTES) * 60 * 1000;
  }

  /** 연결을 모두 끊고 방 데이터를 지웁니다. 화면들은 CLOSED를 받으면 재접속하지 않습니다. */
  private async closeRoom(): Promise<void> {
    const { code } = this.room!;
    for (const socket of this.ctx.getWebSockets()) {
      this.fail(socket, "CLOSED", "방이 닫혔습니다.");
      socket.close(1000, "closed");
    }
    if (this.stageTimer) clearTimeout(this.stageTimer);
    this.stageTimer = null;
    this.room = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    await this.registry().remove(code);
  }

  private allow(socket: WebSocket): boolean {
    const second = Math.floor(Date.now() / 1000);
    const entry = this.limits.get(socket) ?? { second, actions: 0, attempts: 0 };
    if (entry.second !== second) {
      entry.second = second;
      entry.actions = 0;
    }
    entry.actions += 1;
    this.limits.set(socket, entry);
    return entry.actions <= MAX_ACTIONS_PER_SEC;
  }

  /** 입장 코드 확인. 틀린 횟수가 쌓이면 연결을 끊어 무차별 대입을 막습니다. */
  private checkEntry(socket: WebSocket, entryCode: string): boolean {
    const room = this.room!;
    if (!room.entryCode || (room.mode === "team" && room.teams.length === 0)) {
      this.fail(socket, "NOT_READY", "아직 입장 준비 중이에요. 잠시 후 다시 시도해 주세요.");
      return false;
    }
    if (entryCode === room.entryCode) return true;
    const entry = this.limits.get(socket);
    if (entry) entry.attempts += 1;
    if (entry && entry.attempts >= MAX_ENTRY_ATTEMPTS) {
      this.fail(socket, "TOO_MANY_ATTEMPTS", "입장 코드를 너무 많이 틀렸어요. 잠시 후 다시 시도해 주세요.");
      socket.close(4003, "too many attempts");
      return false;
    }
    this.fail(socket, "BAD_ENTRY_CODE", "입장 코드가 맞지 않아요.");
    return false;
  }

  private async join(socket: WebSocket, message: Extract<ClientMessage, { t: "join" }>): Promise<void> {
    const room = this.room!;
    if (!this.checkEntry(socket, message.entryCode)) return;
    if (room.mode === "team" && !room.teams.some(team => team.id === message.teamId)) return this.fail(socket, "BAD_TEAM", "조를 다시 선택해 주세요.");
    if (room.players.some(player => player.nickname === message.nickname)) return this.fail(socket, "NICKNAME_TAKEN", "이미 쓰고 있는 닉네임이에요.");
    if (room.players.length >= MAX_PLAYERS) return this.fail(socket, "ROOM_FULL", `최대 ${MAX_PLAYERS}명까지 입장할 수 있어요.`);
    const player: PlayerState = {
      id: randomToken().slice(0, 12), teamId: room.mode === "team" ? message.teamId : "", name: message.name, nickname: message.nickname, token: randomToken(), score: 0,
    };
    room.players.push(player);
    room.expiresAt = Date.now() + this.idleMs();
    this.ensureRun(player.id);
    this.attachPlayer(socket, player, true);
    await this.save();
    this.report();
  }

  private registry() {
    return this.env.REGISTRY.get(this.env.REGISTRY.idFromName("main"));
  }

  /** 대시보드 목록을 갱신합니다. 실패해도 게임 진행에는 영향을 주지 않습니다. */
  private report(): void {
    const room = this.room;
    if (!room) return;
    const task = this.registry().upsert({
      code: room.code, title: room.title, mode: room.mode, adminToken: room.adminToken, screenKey: room.screenKey, phase: room.phase,
      players: room.players.length, teams: room.teams.length, rounds: room.rounds.length,
      ready: Boolean(room.entryCode) && (room.mode === "solo" || room.teams.length > 0), createdAt: room.createdAt, expiresAt: room.expiresAt,
    }).catch(error => console.error("registry update failed", error));
    this.ctx.waitUntil(task);
  }

  /** 관리자가 바꾼 시간까지 반영한 현재 게임. */
  private currentDef(): GameDef | undefined {
    const room = this.room!;
    const def = games.find(game => game.id === room.gameId);
    return def && withDuration(def, room.durations);
  }

  private attachPlayer(socket: WebSocket, player: PlayerState, isNew = false): void {
    // 같은 사람이 다시 접속하면 예전 연결은 닫아 입력이 겹치지 않게 합니다.
    for (const other of this.ctx.getWebSockets()) {
      if (other !== socket && (other.deserializeAttachment() as Attachment).playerId === player.id) {
        other.serializeAttachment({ role: null } satisfies Attachment);
        other.close(4001, "replaced");
      }
    }
    socket.serializeAttachment({ role: "player", playerId: player.id } satisfies Attachment);
    this.ensureRun(player.id);
    const personal = this.personal(player, rankByScore(this.room!.players));
    this.send(socket, isNew ? { t: "joined", token: player.token, personal } : { t: "personal", personal });
    this.send(socket, this.stageMessage());
    this.queueStage();
  }

  /** 게임 도중 들어온 사람도 바로 참여할 수 있게 합니다. */
  private ensureRun(playerId: string): void {
    const room = this.room!;
    if (["countdown", "playing"].includes(room.phase) && !room.runs[playerId]) room.runs[playerId] = newRun();
  }

  private input(playerId: string, message: Extract<ClientMessage, { t: "input" }>): void {
    const room = this.room!;
    if (room.phase !== "playing" || room.startedAt === null) return;
    const def = this.currentDef();
    if (!def || !room.runs[playerId]) return;
    const now = Date.now();
    let run = room.runs[playerId];
    for (const { at, input } of message.inputs) {
      run = applyInput(def, run, input, room.seed, Math.max(room.startedAt, now - MAX_INPUT_AGE_MS, Math.min(at, now)), room.startedAt);
    }
    if (run === room.runs[playerId]) return;
    room.runs[playerId] = run;
    // 메모리 값만 늘립니다. 알람이 울릴 때 이 값을 보고 다시 예약합니다.
    room.expiresAt = now + this.idleMs();
    this.queueStage();
  }

  private everyoneDone(): boolean {
    const room = this.room!;
    const online = this.onlinePlayers();
    let active = 0;
    for (const id of online) {
      const run = room.runs[id];
      if (!run) continue;
      if (run.finishedAt === null && !run.out) return false;
      active += 1;
    }
    return active > 0;
  }

  private async adminAction(socket: WebSocket, message: ClientMessage): Promise<void> {
    const room = this.room!;
    room.expiresAt = Date.now() + this.idleMs();
    switch (message.t) {
      case "setup": {
        if (["countdown", "playing"].includes(room.phase)) return this.fail(socket, "BUSY", "게임이 끝난 뒤에 저장해 주세요.");
        const gameIds = games.map(game => game.id).filter(id => message.gameIds.includes(id));
        if (gameIds.length === 0) return this.fail(socket, "BAD_SETUP", "게임을 하나 이상 골라 주세요.");
        if (message.mode !== room.mode && room.players.length > 0) return this.fail(socket, "BAD_SETUP", "참가자가 입장한 뒤에는 조 대항전과 개인전을 바꿀 수 없어요.");
        if (message.mode === "team" && message.teams.length === 0) return this.fail(socket, "BAD_SETUP", "조를 하나 이상 입력해 주세요.");
        room.mode = message.mode;
        const names = message.mode === "team" ? [...new Set(message.teams)] : [];
        const kept = new Map(room.teams.map(team => [team.name, team]));
        // 이미 조원이 있는 조는 지울 수 없습니다.
        const missing = room.teams.find(team => !names.includes(team.name) && room.players.some(player => player.teamId === team.id));
        if (missing) return this.fail(socket, "TEAM_NOT_EMPTY", `${missing.name}에 조원이 있어 지울 수 없어요.`);
        const used = new Set(room.teams.filter(team => names.includes(team.name)).map(team => team.color));
        const free = TEAM_COLORS.filter(color => !used.has(color));
        room.title = message.title;
        room.gameIds = gameIds;
        room.durations = message.durations;
        room.entryCode = message.entryCode;
        room.teams = names.map(name => kept.get(name) ?? { id: randomToken().slice(0, 10), name, color: free.shift() ?? TEAM_COLORS[0], score: 0 });
        break;
      }
      case "openSelect":
        if ((room.mode === "team" && room.teams.length === 0) || !["lobby", "result", "rules", "final"].includes(room.phase)) return;
        room.phase = "select";
        room.gameId = null;
        this.clearRound();
        break;
      case "pick":
        // 같은 게임을 여러 번 해도 됩니다. 시작할 때마다 새 문제가 나옵니다.
        if (!["select", "result"].includes(room.phase) || !room.gameIds.includes(message.gameId)) return;
        room.phase = "rules";
        room.gameId = message.gameId;
        this.clearRound();
        break;
      case "start":
        if (room.phase !== "rules") return;
        room.phase = "countdown";
        room.screenTab = "progress";
        room.phaseEndsAt = Date.now() + COUNTDOWN_MS;
        room.seed = crypto.getRandomValues(new Uint32Array(1))[0];
        room.runs = Object.fromEntries(room.players.map(player => [player.id, newRun()]));
        break;
      case "endGame":
        if (room.phase !== "playing") return;
        this.endGame();
        break;
      case "finish":
        if (!["select", "result"].includes(room.phase)) return;
        room.phase = "final";
        room.gameId = null;
        this.clearRound();
        break;
      case "resetScores":
        // 참가자와 설정은 그대로 두고 점수·라운드 기록만 지웁니다.
        if (room.phase === "countdown" || room.phase === "playing") return this.fail(socket, "BUSY", "게임이 끝난 뒤에 초기화해 주세요.");
        for (const team of room.teams) team.score = 0;
        for (const player of room.players) {
          player.score = 0;
          player.prize = false;
        }
        room.rounds = [];
        room.played = [];
        room.expiresAt = Date.now() + this.idleMs();
        room.leaders = [];
        room.gameId = null;
        this.clearRound();
        if (room.phase !== "lobby") room.phase = "select";
        break;
      case "prize": {
        const player = room.players.find(entry => entry.id === message.playerId);
        if (!player) return;
        player.prize = message.on;
        break;
      }
      case "kick": {
        if (room.phase !== "lobby") return;
        room.players = room.players.filter(player => player.id !== message.playerId);
        for (const other of this.ctx.getWebSockets()) {
          if ((other.deserializeAttachment() as Attachment).playerId === message.playerId) {
            other.serializeAttachment({ role: null } satisfies Attachment);
            this.fail(other, "KICKED", "진행자가 내보냈어요. 다시 입장해 주세요.");
            other.close(4002, "kicked");
          }
        }
        break;
      }
      default:
        return;
    }
    await this.commit();
    await this.schedule();
  }

  private clearRound(): void {
    const room = this.room!;
    room.runs = {};
    room.teamRanking = [];
    room.playerRanking = [];
    room.top = [];
  }

  private beginPlaying(now: number): void {
    const room = this.room!;
    const def = this.currentDef()!;
    room.phase = "playing";
    room.startedAt = now;
    // 순간 포착은 가장 늦게 바뀌는 사람도 반응할 시간을 보장합니다.
    room.phaseEndsAt = now + (def.kind === "reflex" ? REFLEX_MAX_DELAY_MS + REFLEX_NO_RESPONSE_MS : def.durationSec * 1000);
  }

  private endGame(): void {
    const room = this.room!;
    const def = this.currentDef()!;
    const teamByPlayer = new Map(room.players.map(player => [player.id, player.teamId]));
    room.playerRanking = rankPlayers(def, room.runs);
    room.teamRanking = rankTeams(room.playerRanking, id => teamByPlayer.get(id), room.teams.map(team => team.id));
    for (const entry of room.teamRanking) {
      const team = room.teams.find(item => item.id === entry.teamId);
      if (team) team.score += entry.points;
    }
    room.top = this.topPlayers(def, room.playerRanking.slice(0, TOP_COUNT).map(entry => entry.playerId));
    // 개인 누적 점수는 상품 순위에 씁니다. 라운드마다 개인 점수(0~100)를 더합니다.
    const scored = new Map(room.playerRanking.map(entry => [entry.playerId, entry.score]));
    for (const player of room.players) player.score += Math.round(scored.get(player.id) ?? 0);
    room.leaders = this.leaders();
    room.played.push({
      gameId: def.id,
      winners: room.teamRanking.filter(entry => entry.rank === 1 && entry.points > 0).map(entry => entry.teamId),
      mvps: this.topPlayers(def, room.playerRanking.filter(entry => entry.rank === 1).slice(0, MAX_MVPS).map(entry => entry.playerId)),
    });
    room.expiresAt = Date.now() + this.idleMs();
    room.rounds.push({
      round: room.rounds.length + 1, gameId: def.id, endedAt: Date.now(), participants: room.playerRanking.length, total: room.players.length,
      teamRanking: room.teamRanking, top: room.top,
    });
    room.phase = "result";
    room.phaseEndsAt = null;
  }

  private leaders(): Leader[] {
    const { players } = this.room!;
    const ranks = rankByScore(players);
    return [...players].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!).slice(0, TOP_COUNT)
      .map(player => ({ rank: ranks.get(player.id)!, nickname: player.nickname, teamId: player.teamId, score: player.score }));
  }

  private topPlayers(def: GameDef, ids: string[]): TopPlayer[] {
    const room = this.room!;
    const byId = new Map(room.players.map(player => [player.id, player]));
    return ids.flatMap(id => {
      const player = byId.get(id);
      return player ? [{ nickname: player.nickname, teamId: player.teamId, label: valueLabel(def, room.runs[id]) }] : [];
    });
  }

  private onlinePlayers(): Set<string> {
    const ids = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      const { playerId } = socket.deserializeAttachment() as Attachment;
      if (playerId) ids.add(playerId);
    }
    return ids;
  }

  private stageMessage(): ServerMessage {
    const room = this.room!;
    const online = this.onlinePlayers();
    const def = this.currentDef();
    const stats = new Map(room.teams.map(team => [team.id, { members: 0, online: 0, playing: 0, total: 0, finished: 0 }]));
    const live: { id: string; run: Run }[] = [];
    for (const player of room.players) {
      // 개인전에서는 조가 없어 stat이 비어 있습니다.
      const stat = stats.get(player.teamId);
      if (stat) {
        stat.members += 1;
        if (online.has(player.id)) stat.online += 1;
      }
      const run = room.runs[player.id];
      if (run?.played && def) {
        if (stat) {
          stat.playing += 1;
          stat.total += liveValue(def, run);
          if (run.finishedAt !== null) stat.finished += 1;
        }
        live.push({ id: player.id, run });
      }
    }
    let top = room.top;
    if (room.phase === "playing" && def) {
      const ranked = rankPlayers(def, Object.fromEntries(live.map(entry => [entry.id, entry.run])));
      top = this.topPlayers(def, ranked.slice(0, TOP_COUNT).map(entry => entry.playerId));
    }
    const stage: StageView = {
      code: room.code, title: room.title, mode: room.mode, screenTab: room.screenTab, leaders: room.leaders, gameIds: room.gameIds, durations: room.durations, phase: room.phase, gameId: room.gameId, seed: room.seed, phaseEndsAt: room.phaseEndsAt, startedAt: room.startedAt,
      teams: room.teams.map(team => {
        const stat = stats.get(team.id)!;
        return { ...team, members: stat.members, online: stat.online, finished: stat.finished, average: stat.playing ? stat.total / stat.playing : 0 };
      }),
      playerCount: room.players.length,
      teamRanking: room.teamRanking,
      top,
      recent: room.players.slice(-12).map(player => player.nickname),
      played: room.played,
    };
    return { t: "stage", now: Date.now(), stage };
  }

  private adminMessage(): ServerMessage {
    const room = this.room!;
    const online = this.onlinePlayers();
    return {
      t: "admin", screenKey: room.screenKey, entryCode: room.entryCode,
      players: room.players.map(({ id, teamId, name, nickname, score, prize }) => ({ id, teamId, name, nickname, score, prize: Boolean(prize), online: online.has(id) })),
      rounds: room.rounds,
    };
  }

  private personal(player: PlayerState, ranks: Map<string, number>): Personal {
    const room = this.room!;
    const ranked = room.playerRanking.find(entry => entry.playerId === player.id);
    return {
      playerId: player.id, teamId: player.teamId, name: player.name, nickname: player.nickname, run: room.runs[player.id] ?? null,
      rank: ranked?.rank ?? null, ranked: room.playerRanking.length,
      score: player.score, overallRank: ranks.get(player.id) ?? room.players.length, playerCount: room.players.length,
    };
  }

  private send(socket: WebSocket, message: ServerMessage | string): void {
    try {
      socket.send(typeof message === "string" ? message : JSON.stringify(message));
    } catch {
      // 이미 닫힌 소켓은 close 이벤트가 정리합니다.
    }
  }

  private fail(socket: WebSocket, code: ErrorCode, message: string): void {
    this.send(socket, { t: "error", code, message });
  }

  /** 메시지를 한 번만 직렬화해 나눠 보냅니다. */
  private broadcast(toPlayers: boolean, personal = false): void {
    if (!this.room) return;
    const stage = JSON.stringify(this.stageMessage());
    // 참가자 명단·통계는 자주 바뀌지 않으니 큰 화면 갱신보다 드물게 보냅니다.
    const admin = toPlayers ? JSON.stringify(this.adminMessage()) : null;
    const players = personal ? new Map(this.room.players.map(player => [player.id, player])) : null;
    const ranks = personal ? rankByScore(this.room.players) : new Map<string, number>();
    for (const socket of this.ctx.getWebSockets()) {
      const { role, playerId } = socket.deserializeAttachment() as Attachment;
      if (role === "admin" && admin) this.send(socket, admin);
      if (role === "admin" || role === "screen" || (role === "player" && toPlayers)) this.send(socket, stage);
      const player = playerId ? players?.get(playerId) : undefined;
      if (player) this.send(socket, { t: "personal", personal: this.personal(player, ranks) });
    }
  }

  /** 입력이 몰려도 일정 간격으로만 알리고 저장은 더 드물게 합니다. */
  private queueStage(): void {
    if (this.stageTimer) return;
    this.stageTimer = setTimeout(() => {
      this.stageTimer = null;
      const room = this.room;
      if (!room) return;
      if (room.phase === "playing" && this.everyoneDone()) {
        this.endGame();
        void this.commit().then(() => this.schedule());
        return;
      }
      this.stageTicks = (this.stageTicks + 1) % PLAYER_STAGE_EVERY;
      this.broadcast(this.stageTicks === 0);
      if (Date.now() - this.lastSave >= SAVE_MS) void this.save();
    }, STAGE_MS);
  }

  private async save(): Promise<void> {
    if (!this.room) return;
    this.lastSave = Date.now();
    await this.ctx.storage.put("room", this.room);
  }

  /** 단계가 바뀌면 모두에게 바로 알립니다. */
  private async commit(): Promise<void> {
    await this.save();
    this.broadcast(true, true);
    this.report();
  }

  private async schedule(): Promise<void> {
    const room = this.room;
    if (!room) return;
    await this.ctx.storage.setAlarm(Math.min(room.expiresAt, room.phaseEndsAt ?? Infinity));
  }
}
