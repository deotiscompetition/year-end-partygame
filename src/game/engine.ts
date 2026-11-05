// 서버(Worker)와 폰이 함께 쓰는 순수 게임 규칙입니다. 같은 입력이면 양쪽 결과가 항상 같아야 합니다.

export type GameKind = "counter" | "quiz" | "race" | "gauge" | "reflex" | "memory" | "updown";

export type GameDef = {
  id: string;
  kind: GameKind;
  input?: string;
  category: string;
  name: string;
  icon: string;
  durationSec: number;
  goal?: number;
  summary: string;
  rules: string[];
  unit: string;
  penaltyMs?: number;
};

/** 팀 하나의 게임 진행 상태. 값이 전부 직렬화 가능해야 합니다. */
export type Run = {
  value: number;
  index: number;
  wrong: number;
  finishedAt: number | null;
  out: boolean;
  played: boolean;
  lastFoot: "L" | "R" | null;
  hint: "up" | "down" | "correct" | null;
};

export type GameInput =
  | { type: "count"; n: number }
  | { type: "answer"; index: number; choice: number }
  | { type: "foot"; foot: "L" | "R" }
  | { type: "gauge"; ms: number }
  | { type: "reflex"; ms: number | null }
  | { type: "memory"; index: number; cells: number[] }
  | { type: "guess"; value: number };

export type Question = {
  prompt: string;
  detail?: string;
  /** 글자색 고르기에서 글자를 칠할 색 */
  ink?: string;
  choices: string[];
  answer: number;
};

export const RACE_METERS = 100;
export const RACE_STRIDE = 2;
export const MEMORY_GRID = 16;
export const MEMORY_LIVES = 3;
export const REFLEX_MIN_DELAY_MS = 2000;
export const REFLEX_MAX_DELAY_MS = 7000;
export const REFLEX_NO_RESPONSE_MS = 5000;
/** 사람이 낼 수 없는 반응 속도는 미리 누른 것으로 봅니다. */
export const REFLEX_MIN_HUMAN_MS = 80;

export const STROOP_COLORS = [
  { name: "빨강", value: "#ff5d5d" },
  { name: "파랑", value: "#5aa2ff" },
  { name: "초록", value: "#4fd88a" },
  { name: "노랑", value: "#ffd84d" },
] as const;

// 시드가 같으면 모든 팀이 같은 문제를 받아 공정합니다.
function hash(seed: number, a: number, b = 0): number {
  let h = (seed ^ Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const pick = (seed: number, a: number, b: number, size: number) => hash(seed, a, b) % size;

export function shuffled(seed: number, salt: number, size: number): number[] {
  const list = Array.from({ length: size }, (_, i) => i);
  for (let i = size - 1; i > 0; i--) {
    const j = pick(seed, salt, i, i + 1);
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

export function question(id: string, seed: number, index: number): Question {
  switch (id) {
    case "mole":
      return { prompt: "", choices: Array(9).fill(""), answer: pick(seed, index, 1, 9) };
    case "keys":
      return { prompt: "", choices: Array(4).fill(""), answer: pick(seed, index, 1, 4) };
    case "order": {
      const layout = shuffled(seed, 7, 16);
      return { prompt: String(index + 1), choices: layout.map(n => String(n + 1)), answer: layout.indexOf(index) };
    }
    case "oddEven": {
      const a = 2 + pick(seed, index, 1, 48);
      const b = 2 + pick(seed, index, 2, 48);
      const plus = pick(seed, index, 3, 2) === 0;
      const result = plus ? a + b : Math.max(a, b) - Math.min(a, b);
      return { prompt: plus ? `${a} + ${b}` : `${Math.max(a, b)} − ${Math.min(a, b)}`, choices: ["홀수", "짝수"], answer: result % 2 === 0 ? 1 : 0 };
    }
    case "leftRight": {
      const arrowLeft = pick(seed, index, 1, 2) === 0;
      const same = pick(seed, index, 2, 2) === 0;
      return { prompt: arrowLeft ? "←" : "→", detail: same ? "같은 쪽" : "반대 쪽", choices: ["왼쪽", "오른쪽"], answer: arrowLeft === same ? 0 : 1 };
    }
    case "stroop": {
      const word = pick(seed, index, 1, 4);
      const ink = (word + 1 + pick(seed, index, 2, 3)) % 4;
      return { prompt: STROOP_COLORS[word].name, ink: STROOP_COLORS[ink].value, choices: STROOP_COLORS.map(c => c.name), answer: ink };
    }
    case "rps": {
      const hands = ["가위", "바위", "보"];
      const shown = pick(seed, index, 1, 3);
      const win = pick(seed, index, 2, 2) === 0;
      return { prompt: hands[shown], detail: win ? "이겨라" : "져라", choices: hands, answer: (shown + (win ? 1 : 2)) % 3 };
    }
    case "times": {
      const a = 2 + pick(seed, index, 1, 8);
      const b = 2 + pick(seed, index, 2, 8);
      const correct = a * b;
      const options = [correct, correct + a, correct - b, correct + b + 1];
      const order = shuffled(seed, 100 + index, 4);
      return { prompt: `${a} × ${b}`, choices: order.map(i => String(options[i])), answer: order.indexOf(0) };
    }
    default:
      throw new Error(`no questions for ${id}`);
  }
}

export function memoryPattern(seed: number, level: number): number[] {
  return shuffled(seed, 500 + level, MEMORY_GRID).slice(0, level + 3).sort((a, b) => a - b);
}

export const secretNumber = (seed: number) => 1 + pick(seed, 900, 1, 100);

/** 팀마다 다른 순간에 화면이 바뀌어 옆 팀을 보고 누를 수 없습니다. */
export function reflexDelay(seed: number, teamId: string): number {
  let salt = 0;
  for (const char of teamId) salt = (salt * 31 + char.charCodeAt(0)) >>> 0;
  return REFLEX_MIN_DELAY_MS + pick(seed, 700, salt, REFLEX_MAX_DELAY_MS - REFLEX_MIN_DELAY_MS);
}

export function newRun(): Run {
  return { value: 0, index: 0, wrong: 0, finishedAt: null, out: false, played: false, lastFoot: null, hint: null };
}

/** 입력을 적용해 새 Run을 돌려줍니다. 무시할 입력이면 그대로 돌려줍니다. now·startedAt은 서버 시각입니다. */
export function applyInput(def: GameDef, run: Run, input: GameInput, seed: number, now: number, startedAt: number): Run {
  if (run.finishedAt !== null || run.out) return run;
  const next = { ...run, played: true };
  const finish = (value: number) => ({ ...next, value, finishedAt: now });
  switch (input.type) {
    case "count":
      return def.kind === "counter" ? { ...next, value: run.value + input.n } : run;
    case "foot": {
      if (def.kind !== "race" || input.foot === run.lastFoot) return run;
      const value = run.value + RACE_STRIDE;
      return value >= RACE_METERS ? { ...finish(RACE_METERS), lastFoot: input.foot } : { ...next, value, lastFoot: input.foot };
    }
    case "answer": {
      if (def.kind !== "quiz" || input.index !== run.index) return run;
      if (question(def.id, seed, run.index).answer !== input.choice) return { ...next, wrong: run.wrong + 1 };
      const value = run.value + 1;
      const advanced = { ...next, value, index: run.index + 1 };
      return def.goal && value >= def.goal ? { ...advanced, finishedAt: now } : advanced;
    }
    case "gauge":
      if (def.kind !== "gauge") return run;
      return { ...next, value: Math.min(def.durationSec * 1000, run.value + Math.max(0, Math.min(1000, input.ms))) };
    case "reflex": {
      if (def.kind !== "reflex") return run;
      if (input.ms === null || input.ms < REFLEX_MIN_HUMAN_MS) return { ...next, out: true };
      const ms = Math.min(input.ms, REFLEX_NO_RESPONSE_MS);
      return { ...next, value: ms, finishedAt: startedAt + ms };
    }
    case "memory": {
      if (def.kind !== "memory" || input.index !== run.index) return run;
      const expected = memoryPattern(seed, run.index);
      const cells = [...new Set(input.cells)].sort((a, b) => a - b);
      if (cells.length === expected.length && cells.every((cell, i) => cell === expected[i])) {
        const value = run.value + 1;
        const advanced = { ...next, value, index: run.index + 1 };
        return def.goal && value >= def.goal ? { ...advanced, finishedAt: now } : advanced;
      }
      const wrong = run.wrong + 1;
      return { ...next, wrong, out: wrong >= MEMORY_LIVES };
    }
    case "guess": {
      if (def.kind !== "updown") return run;
      const secret = secretNumber(seed);
      const value = run.value + 1;
      if (input.value === secret) return { ...finish(value), hint: "correct" };
      return { ...next, value, hint: input.value < secret ? "up" : "down" };
    }
  }
}

function compare(def: GameDef, a: Run, b: Run): number {
  if (a.played !== b.played) return a.played ? -1 : 1;
  if ((a.finishedAt !== null) !== (b.finishedAt !== null)) return a.finishedAt !== null ? -1 : 1;
  if (a.finishedAt !== null && b.finishedAt !== null) return a.finishedAt - b.finishedAt;
  // 업다운은 못 맞혔을 때 시도 횟수가 순위에 영향을 주지 않습니다.
  if (def.kind === "updown" || def.kind === "reflex") return 0;
  return b.value - a.value;
}

export type PlayerRank = { playerId: string; rank: number; score: number };
export type TeamRank = { teamId: string; rank: number; points: number; average: number; members: number };

/** 참가자 전원의 개인 순위. score는 1등 100, 꼴찌 0에 가까운 값이고 동점은 같은 등수입니다. 미참여자는 순위에서 뺍니다. */
export function rankPlayers(def: GameDef, runs: Record<string, Run>): PlayerRank[] {
  const ids = Object.keys(runs).filter(id => runs[id].played).sort((a, b) => compare(def, runs[a], runs[b]));
  const total = ids.length;
  let rank = 0;
  return ids.map((playerId, i) => {
    if (i === 0 || compare(def, runs[ids[i - 1]], runs[playerId]) !== 0) rank = i + 1;
    return { playerId, rank, score: total <= 1 ? 100 : (100 * (total - rank)) / (total - 1) };
  });
}

/** 판마다 1·2·3등 조가 받는 점수. 역전할 수 있도록 차이를 크지 않게 둡니다. */
export const TEAM_RANK_POINTS = [10, 7, 5];
/** 4등 이하 조가 받는 점수. 참여자가 없는 조는 0점입니다. */
export const TEAM_REST_POINTS = 1;

/** 인원이 다른 조도 공정하도록 참여한 조원의 평균 점수로 조 순위를 냅니다. 동점은 같은 등수·같은 점수입니다. */
export function rankTeams(players: PlayerRank[], teamOf: (playerId: string) => string | undefined, teamIds: string[]): TeamRank[] {
  const sums = new Map<string, { total: number; members: number }>(teamIds.map(id => [id, { total: 0, members: 0 }]));
  for (const player of players) {
    const entry = sums.get(teamOf(player.playerId) ?? "");
    if (entry) {
      entry.total += player.score;
      entry.members += 1;
    }
  }
  const rows = teamIds
    .map(teamId => {
      const { total, members } = sums.get(teamId)!;
      return { teamId, members, average: members ? total / members : 0 };
    })
    .sort((a, b) => Number(b.members > 0) - Number(a.members > 0) || b.average - a.average);
  let rank = 0;
  return rows.map((row, i) => {
    const previous = rows[i - 1];
    if (!previous || previous.average !== row.average || previous.members === 0 !== (row.members === 0)) rank = i + 1;
    return { ...row, rank, points: row.members ? TEAM_RANK_POINTS[rank - 1] ?? TEAM_REST_POINTS : 0 };
  });
}

/** 큰 화면에 보여 줄 값. */
export function valueLabel(def: GameDef, run: Run): string {
  if (run.out) return def.kind === "memory" ? `${run.value}${def.unit} (탈락)` : "실격";
  if (def.kind === "gauge") return `${(run.value / 1000).toFixed(1)}초`;
  if (def.kind === "reflex") return run.finishedAt === null ? "대기" : `${run.value}ms`;
  if (def.kind === "updown") return run.finishedAt === null ? `${run.value}회 시도` : `${run.value}회 만에 정답`;
  return `${run.value}${def.unit}`;
}

/** 조 진행 막대에 쓰는 개인 값. 완주형은 완주 여부를, 나머지는 현재 값을 씁니다. */
export function liveValue(def: GameDef, run: Run): number {
  if (def.kind === "updown" || def.kind === "reflex") return run.finishedAt !== null ? 1 : 0;
  return run.value;
}

/** 조 평균 값을 큰 화면 문구로 바꿉니다. */
export function averageLabel(def: GameDef, average: number): string {
  if (def.kind === "updown" || def.kind === "reflex") return `완료 ${Math.round(average * 100)}%`;
  if (def.kind === "gauge") return `평균 ${(average / 1000).toFixed(1)}초`;
  return `평균 ${average.toFixed(1)}${def.unit}`;
}

/** 조 진행 막대 길이(0~1). 정해진 목표가 없으면 현재 1등 조 기준입니다. */
export function barLength(def: GameDef, average: number, best: number): number {
  if (def.kind === "race") return average / RACE_METERS;
  if (def.kind === "updown" || def.kind === "reflex") return average;
  if (def.goal) return Math.min(1, average / def.goal);
  return best > 0 ? average / best : 0;
}

// 온도 맞추기: 시드로 정해진 구간이 시간에 따라 천천히 움직입니다. 값은 모두 0~1.
export function gaugeBand(seed: number, elapsedMs: number): { low: number; high: number } {
  const phase = (hash(seed, 800) % 628) / 100;
  const center = 0.5 + 0.28 * Math.sin(elapsedMs / 2600 + phase);
  return { low: center - 0.11, high: center + 0.11 };
}
