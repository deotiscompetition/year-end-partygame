// 관리자·행사장 화면·참가자 폰과 Durable Object가 주고받는 메시지 형식입니다.
import { z } from "zod";
import type { GameDef, Run, TeamRank } from "./engine";

export const MAX_PLAYERS = 500;
export const MAX_TEAMS = 30;
export const MAX_ENTRY_ATTEMPTS = 10;
export const COUNTDOWN_MS = 3000;
/** 폰이 입력을 모아 서버로 보내는 간격 */
export const INPUT_FLUSH_MS = 500;

export const TEAM_COLORS = [
  "#ff6b6b", "#ffd84d", "#4fd88a", "#5aa2ff", "#c98bff", "#ff9f43", "#3fd9d0", "#ff8ad4", "#a4e04f", "#8aa7ff",
  "#f0705a", "#e8c547", "#39c28a", "#49b6ff", "#b774f5", "#ffb26b", "#5de6c8", "#f59ac8", "#c7e25a", "#b3c0ff",
  "#e85d75", "#d4b13f", "#2fae7d", "#3a9be0", "#a35fe0", "#e89a55", "#46c7b3", "#de85b5", "#b0cc4a", "#9aa9e8",
];

export type Phase = "lobby" | "select" | "rules" | "countdown" | "playing" | "result" | "final";

export type TeamInfo = { id: string; name: string; color: string };
export type TeamView = TeamInfo & { score: number; members: number; online: number; average: number; finished: number };
export type TopPlayer = { nickname: string; teamId: string; label: string };
/** mvps는 해당 라운드 개인 1등입니다. 동점이면 여러 명입니다. */
export type PlayedGame = { gameId: string; winners: string[]; mvps: TopPlayer[] };
export type GameMode = "team" | "solo";
/** 행사장 화면의 탭. 게임 시작 시 진행으로 돌아가고, 게임 중에는 바꿀 수 없습니다. */
export type ScreenTab = "progress" | "ranking";
/** 전체 라운드를 합산한 개인 순위 한 줄 */
export type Leader = { rank: number; nickname: string; teamId: string; score: number };

/** 누적 점수 순위. 동점은 같은 등수입니다. */
export function rankByScore(players: { id: string; score: number }[]): Map<string, number> {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const ranks = new Map<string, number>();
  sorted.forEach((player, i) => ranks.set(player.id, i > 0 && sorted[i - 1].score === player.score ? ranks.get(sorted[i - 1].id)! : i + 1));
  return ranks;
}

/** 관리자 통계에 쌓이는 라운드 기록 */
export type RoundRecord = { round: number; gameId: string; endedAt: number; participants: number; total: number; teamRanking: TeamRank[]; top: TopPlayer[] };

/** 대시보드에 보이는 방 요약. 대시보드는 관리자 비밀번호로만 열립니다. */
export type RoomEntry = {
  code: string;
  title: string;
  mode: GameMode;
  adminToken: string;
  screenKey: string;
  phase: Phase;
  players: number;
  teams: number;
  rounds: number;
  /** 입장 코드 등 입장 준비가 끝났는지. 인트로 페이지 QR 목록에 씁니다. */
  ready: boolean;
  createdAt: number;
  expiresAt: number;
};

/** 인트로 페이지에 공개되는 방 정보. 토큰이나 키를 넣지 않습니다. */
export type PublicRoom = { code: string; title: string };

export const MIN_DURATION_SEC = 5;
export const MAX_DURATION_SEC = 180;

/** 관리자가 바꾼 시간을 반영한 게임 정보. 서버와 폰이 같은 값을 써야 합니다. */
export function withDuration(def: GameDef, durations: Record<string, number>): GameDef {
  const durationSec = durations[def.id];
  return durationSec ? { ...def, durationSec } : def;
}

/** 모두가 받는 방 상태. 참가자 수에 따라 커지지 않습니다. */
export type StageView = {
  code: string;
  title: string;
  mode: GameMode;
  screenTab: ScreenTab;
  leaders: Leader[];
  gameIds: string[];
  durations: Record<string, number>;
  phase: Phase;
  gameId: string | null;
  seed: number;
  phaseEndsAt: number | null;
  startedAt: number | null;
  teams: TeamView[];
  playerCount: number;
  teamRanking: TeamRank[];
  top: TopPlayer[];
  recent: string[];
  played: PlayedGame[];
};

export type PlayerSummary = { id: string; teamId: string; name: string; nickname: string; online: boolean; score: number; prize: boolean };

export type Personal = {
  playerId: string; teamId: string; name: string; nickname: string; run: Run | null; rank: number | null; ranked: number;
  score: number; overallRank: number; playerCount: number;
};

const text = (max: number) => z.string().trim().min(1).max(max);

const gameInput = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("count"), n: z.number().int().min(1).max(30) }),
  z.strictObject({ type: z.literal("answer"), index: z.number().int().min(0), choice: z.number().int().min(0).max(20) }),
  z.strictObject({ type: z.literal("foot"), foot: z.enum(["L", "R"]) }),
  z.strictObject({ type: z.literal("gauge"), ms: z.number().min(0).max(5000) }),
  z.strictObject({ type: z.literal("reflex"), ms: z.number().min(0).max(60000).nullable() }),
  z.strictObject({ type: z.literal("memory"), index: z.number().int().min(0), cells: z.array(z.number().int().min(0).max(15)).max(16) }),
  z.strictObject({ type: z.literal("guess"), value: z.number().int().min(1).max(100) }),
]);

export const clientMessage = z.discriminatedUnion("t", [
  z.strictObject({ t: z.literal("admin"), token: z.string().min(1).max(64) }),
  z.strictObject({ t: z.literal("screen"), key: z.string().min(1).max(64) }),
  z.strictObject({ t: z.literal("enter"), entryCode: text(20) }),
  z.strictObject({ t: z.literal("join"), entryCode: text(20), teamId: z.string().max(32), name: text(20), nickname: text(12) }),
  z.strictObject({ t: z.literal("resume"), token: z.string().min(1).max(64) }),
  // at은 입력이 실제로 일어난 서버 기준 시각입니다. 묶어 보내도 골인 순서가 밀리지 않습니다.
  z.strictObject({ t: z.literal("input"), inputs: z.array(z.strictObject({ at: z.number(), input: gameInput })).min(1).max(40) }),
  z.strictObject({
    t: z.literal("setup"),
    title: text(30),
    mode: z.enum(["team", "solo"]),
    entryCode: text(20),
    teams: z.array(text(12)).max(MAX_TEAMS),
    gameIds: z.array(z.string().max(20)).min(1).max(30),
    durations: z.record(z.string().max(20), z.number().int().min(MIN_DURATION_SEC).max(MAX_DURATION_SEC)),
  }),
  z.strictObject({ t: z.literal("openSelect") }),
  z.strictObject({ t: z.literal("pick"), gameId: z.string().max(20) }),
  z.strictObject({ t: z.literal("start") }),
  z.strictObject({ t: z.literal("endGame") }),
  z.strictObject({ t: z.literal("finish") }),
  z.strictObject({ t: z.literal("kick"), playerId: z.string().max(32) }),
  z.strictObject({ t: z.literal("prize"), playerId: z.string().max(32), on: z.boolean() }),
  z.strictObject({ t: z.literal("screenTab"), tab: z.enum(["progress", "ranking"]) }),
  z.strictObject({ t: z.literal("resetScores") }),
]);
export type ClientMessage = z.infer<typeof clientMessage>;

export type ErrorCode =
  | "BAD_ENTRY_CODE" | "TOO_MANY_ATTEMPTS" | "NOT_READY" | "NICKNAME_TAKEN" | "ROOM_FULL" | "BAD_TEAM" | "BAD_TOKEN"
  | "BAD_MESSAGE" | "TEAM_NOT_EMPTY" | "BUSY" | "BAD_SETUP" | "KICKED" | "CLOSED";

export type ServerMessage =
  | { t: "stage"; now: number; stage: StageView }
  | { t: "admin"; screenKey: string; entryCode: string; players: PlayerSummary[]; rounds: RoundRecord[] }
  | { t: "screenOk" }
  | { t: "entered"; mode: GameMode; teams: TeamInfo[] }
  | { t: "joined"; token: string; personal: Personal }
  | { t: "personal"; personal: Personal }
  | { t: "error"; code: ErrorCode; message: string };
