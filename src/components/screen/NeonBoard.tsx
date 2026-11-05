"use client";

import { Star } from "lucide-react";
import type { CSSProperties } from "react";
import { gameById } from "@/components/shared";
import type { PlayedGame, StageView, TeamView } from "@/game/protocol";

const CYAN = "#00e5ff";
const PINK = "#ff2fd0";
const YELLOW = "#ffd400";
const HISTORY_COUNT = 8;
const glow = (color: string) => ({ "--glow": color }) as CSSProperties;

function teamsOf(stage: StageView, ids: string[]): TeamView[] {
  return ids.flatMap(id => stage.teams.filter(team => team.id === id));
}

/** 라운드 결과: 왼쪽에 1등을 크게, 오른쪽에 누적 순위를 보여 줍니다. */
export function RoundResult({ stage }: { stage: StageView }) {
  const latest = stage.played.at(-1);
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,30%)] gap-6">
        <section className="marquee flex min-w-0 flex-col items-center justify-center gap-4 text-center">
          {latest && <Winner stage={stage} played={latest} round={stage.played.length} />}
        </section>
        <div className="flex min-h-0 flex-col gap-4">
          {stage.mode === "team" && <TeamRanks stage={stage} limit={5} />}
          <Leaders stage={stage} />
        </div>
      </div>
      <History stage={stage} />
    </div>
  );
}

/** 순위 탭: 누적 순위만 화면 가득 보여 줍니다. 개인전은 개인 순위만 나옵니다. */
export function RankingView({ stage }: { stage: StageView }) {
  return (
    <div className={`mx-auto grid h-full w-full gap-6 ${stage.mode === "team" ? "grid-cols-2" : "max-w-3xl grid-cols-1"}`}>
      {stage.mode === "team" && <TeamRanks stage={stage} limit={10} large />}
      <Leaders stage={stage} large />
    </div>
  );
}

function Names({ names }: { names: { key: string; label: string; color: string }[] }) {
  return (
    <p className="text-8xl font-black">
      {names.map((name, i) => <span key={name.key} className="neon-text neon-flicker" style={glow(name.color)}>{i > 0 && ", "}{name.label}</span>)}
    </p>
  );
}

function Winner({ stage, played, round }: { stage: StageView; played: PlayedGame; round: number }) {
  const mvps = played.mvps.map(player => player.nickname).join(", ");
  const names = stage.mode === "team"
    ? teamsOf(stage, played.winners).map(team => ({ key: team.id, label: team.name, color: team.color }))
    : played.mvps.map(player => ({ key: player.nickname, label: player.nickname, color: YELLOW }));
  return (
    <>
      <p className="neon-text text-4xl font-bold" style={glow(CYAN)}>{round}라운드 · {gameById(played.gameId)?.name}</p>
      <div className="flex items-center gap-4" aria-hidden>
        <Star className="neon-icon size-10" style={glow(PINK)} />
        <Star className="neon-icon neon-flicker size-16" style={glow(YELLOW)} />
        <Star className="neon-icon size-10" style={glow(CYAN)} />
      </div>
      {names.length ? <Names names={names} /> : <p className="text-5xl font-black">참여자 없음</p>}
      <p className="neon-text text-6xl font-black" style={glow(YELLOW)}>1등!</p>
      {stage.mode === "team" && mvps && <p className="neon-text text-3xl" style={glow(PINK)}>개인 1등 {mvps}</p>}
    </>
  );
}

function TeamRanks({ stage, limit, large }: { stage: StageView; limit: number; large?: boolean }) {
  const teams = [...stage.teams].sort((a, b) => b.score - a.score);
  return (
    <aside className={`neon-frame flex min-h-0 flex-col gap-1 overflow-hidden p-4 ${large ? "flex-1" : "shrink-0"}`} style={glow(YELLOW)}>
      <h2 className={`neon-text text-center font-black ${large ? "text-4xl" : "text-xl"}`} style={glow(YELLOW)}>조 순위</h2>
      <ol className={`flex min-h-0 flex-1 flex-col gap-0.5 ${large ? "justify-around text-3xl" : ""}`}>
        {teams.slice(0, limit).map(team => (
          <li key={team.id} className="flex items-baseline gap-3">
            <span className="neon-text w-10 text-right font-black tabular-nums" style={glow(team.color)}>{teams.findIndex(other => other.score === team.score) + 1}</span>
            <span className="neon-text min-w-0 flex-1 truncate font-bold" style={glow(team.color)}>{team.name}</span>
            <span className="tabular-nums text-mist">{team.score}점</span>
          </li>
        ))}
      </ol>
    </aside>
  );
}

/** 상품 안내용 개인 누적 순위. 행사장 화면에는 닉네임만 보입니다. */
function Leaders({ stage, large }: { stage: StageView; large?: boolean }) {
  return (
    <aside className="neon-frame flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-4" style={glow(PINK)}>
      <h2 className={`neon-text text-center font-black ${large ? "text-4xl" : "text-2xl"}`} style={glow(PINK)}>개인 순위 TOP {stage.leaders.length || 10}</h2>
      {stage.leaders.length === 0 ? <p className="my-auto text-center text-mist">첫 라운드가 끝나면 나와요</p> : (
        <ol className="flex min-h-0 flex-1 flex-col justify-around">
          {stage.leaders.map(leader => {
            const color = leader.rank === 1 ? YELLOW : leader.rank <= 3 ? PINK : CYAN;
            return (
              <li key={leader.nickname} className={`flex items-baseline gap-3 ${large ? "text-3xl" : "text-base leading-6"}`}>
                <span className="neon-text w-10 text-right font-black tabular-nums" style={glow(color)}>{leader.rank}</span>
                <span className={`neon-text min-w-0 flex-1 truncate ${leader.rank <= 3 ? "font-black" : "font-bold"}`} style={glow(color)}>{leader.nickname}</span>
                <span className="tabular-nums text-mist">{leader.score}점</span>
              </li>
            );
          })}
        </ol>
      )}
    </aside>
  );
}

function History({ stage }: { stage: StageView }) {
  const first = Math.max(0, stage.played.length - HISTORY_COUNT);
  return (
    <ol className="flex shrink-0 justify-center gap-2 overflow-hidden" aria-label="최근 라운드 1등">
      {stage.played.slice(first).map((played, i) => {
        const names = stage.mode === "team" ? teamsOf(stage, played.winners).map(team => team.name) : played.mvps.map(player => player.nickname);
        return (
          <li key={first + i} className="neon-frame flex shrink-0 items-center gap-2 px-3 py-1 text-sm" style={glow(CYAN)}>
            <span className="text-mist">{first + i + 1}R</span>
            <span className="max-w-32 truncate font-bold">{names.join(", ") || "-"}</span>
          </li>
        );
      })}
    </ol>
  );
}
