"use client";

import { useState } from "react";
import { gameById } from "@/components/shared";
import { rankByScore, type PlayerSummary, type RoundRecord, type StageView } from "@/game/protocol";

type Props = { stage: StageView; rounds: RoundRecord[]; players: PlayerSummary[]; onPrize: (playerId: string, on: boolean) => void; onReset: () => void };

/** 게임이 끝날 때마다 쌓이는 관리자 통계: 개인 종합 순위, 조별 점수표, 라운드 상세. */
export function RoundStats({ stage, rounds, players, onPrize, onReset }: Props) {
  const running = stage.phase === "countdown" || stage.phase === "playing";
  function confirmReset() {
    if (window.confirm("점수와 라운드 기록, 상품 후보를 모두 지울까요?\n참가자와 방 설정은 그대로 남습니다. 되돌릴 수 없습니다.")) onReset();
  }
  const teams = [...stage.teams].sort((a, b) => b.score - a.score);
  const latest = rounds.at(-1)?.round;
  const isTeam = stage.mode === "team";
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold">통계 <span className="font-normal text-mist">({rounds.length}라운드 완료)</span></h2>
        <button onClick={confirmReset} disabled={running || rounds.length === 0} className="rounded-lg border border-berry px-3 py-1 text-sm font-bold text-berry disabled:opacity-40">점수 초기화</button>
      </div>
      {rounds.length === 0 ? <p className="text-sm text-mist">게임이 끝나면 여기에 점수가 쌓여요.</p> : (
        <>
          <PlayerRanking stage={stage} players={players} onPrize={onPrize} />
          {isTeam && (
            <div className="overflow-x-auto">
              <h3 className="mb-1 text-sm text-mist">조별 점수표</h3>
              <table className="w-full text-left text-sm">
                <thead className="text-mist">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-normal">순위</th>
                    <th scope="col" className="py-1 pr-3 font-normal">조</th>
                    {rounds.map(round => <th key={round.round} scope="col" title={gameById(round.gameId)?.name} className="px-2 py-1 text-center font-normal">{round.round}R</th>)}
                    <th scope="col" className="py-1 pl-3 text-right font-normal">합계</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map(team => (
                    <tr key={team.id} className="border-t border-line">
                      <td className="py-1.5 pr-3 tabular-nums">{teams.findIndex(other => other.score === team.score) + 1}</td>
                      <th scope="row" className="whitespace-nowrap py-1.5 pr-3 font-bold">
                        <span className="mr-2 inline-block size-2.5 rounded-full" style={{ background: team.color }} />{team.name}
                      </th>
                      {rounds.map(round => {
                        const row = round.teamRanking.find(entry => entry.teamId === team.id);
                        return <td key={round.round} className={`px-2 py-1.5 text-center tabular-nums ${row?.rank === 1 && row.points > 0 ? "font-bold text-gold" : ""}`}>{row?.points ?? "-"}</td>;
                      })}
                      <td className="py-1.5 pl-3 text-right font-bold tabular-nums">{team.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex flex-col gap-2">
            {[...rounds].reverse().map(round => (
              <details key={round.round} open={round.round === latest} className="rounded-lg bg-night p-3 text-sm">
                <summary className="cursor-pointer font-bold">
                  {round.round}라운드 · {gameById(round.gameId)?.name}
                  <span className="ml-2 font-normal text-mist">{round.participants}/{round.total}명 참여 · {new Date(round.endedAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</span>
                </summary>
                <div className={`mt-2 grid gap-4 ${isTeam ? "sm:grid-cols-2" : ""}`}>
                  {isTeam && (
                    <div>
                      <h3 className="mb-1 text-mist">조 순위 (평균 점수 → 획득 점수)</h3>
                      <ol className="flex flex-col gap-0.5">
                        {round.teamRanking.map(row => (
                          <li key={row.teamId} className="flex justify-between gap-2">
                            <span>{row.members ? `${row.rank}등` : "-"} {stage.teams.find(team => team.id === row.teamId)?.name}{!row.members && " (미참여)"}</span>
                            <span className="tabular-nums text-mist">{row.members ? `${row.average.toFixed(1)} → ` : ""}<b className="text-snow">+{row.points}</b></span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <div>
                    <h3 className="mb-1 text-mist">개인 상위 기록</h3>
                    <ol className="flex flex-col gap-0.5">
                      {round.top.map((player, i) => (
                        <li key={player.nickname} className="flex justify-between gap-2">
                          <span>{i + 1}. {player.nickname}</span>
                          <span className="tabular-nums text-mist">{player.label}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              </details>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** 상품 전달용 전체 개인 순위. 실명은 관리자 화면에서만 보입니다. */
function PlayerRanking({ stage, players, onPrize }: Pick<Props, "stage" | "players" | "onPrize">) {
  const [teamFilter, setTeamFilter] = useState("");
  const isTeam = stage.mode === "team";
  const ranks = rankByScore(players);
  const sorted = [...players].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!);
  const shown = teamFilter ? sorted.filter(player => player.teamId === teamFilter) : sorted;
  const picked = sorted.filter(player => player.prize);
  // 조별 1등: 정렬된 목록에서 조마다 최고 점수인 사람(동점 포함)입니다.
  const teamBest = stage.teams.map(team => {
    const members = sorted.filter(player => player.teamId === team.id);
    return { team, best: members.filter(player => player.score === members[0]?.score) };
  }).filter(entry => entry.best.length > 0);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm text-mist">개인 종합 순위 (전체 {players.length}명 · 상품 후보 {picked.length}명)</h3>
        {isTeam && (
          <label className="flex items-center gap-2 text-sm text-mist">
            조 보기
            <select value={teamFilter} onChange={event => setTeamFilter(event.target.value)} className="rounded border border-line bg-night px-2 py-1 text-snow">
              <option value="">전체</option>
              {stage.teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
            </select>
          </label>
        )}
      </div>
      {isTeam && (
        <ul className="flex flex-wrap gap-2 text-sm" aria-label="조별 1등">
          {teamBest.map(({ team, best }) => (
            <li key={team.id} className="rounded-full bg-night px-3 py-1">
              <span className="mr-1 inline-block size-2.5 rounded-full" style={{ background: team.color }} />
              {team.name} 1등 <b>{best.map(player => player.nickname).join(", ")}</b>
            </li>
          ))}
        </ul>
      )}
      {picked.length > 0 && <p className="text-sm text-gold">상품 후보: {picked.map(player => `${player.nickname}(${player.name})`).join(", ")}</p>}
      <div className="max-h-72 overflow-y-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-panel text-mist">
            <tr>
              <th scope="col" className="py-1 pr-2 font-normal">상품</th>
              <th scope="col" className="py-1 pr-3 font-normal">순위</th>
              <th scope="col" className="py-1 pr-3 font-normal">닉네임</th>
              <th scope="col" className="py-1 pr-3 font-normal">이름</th>
              {stage.mode === "team" && <th scope="col" className="py-1 pr-3 font-normal">조</th>}
              <th scope="col" className="py-1 text-right font-normal">누적 점수</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(player => (
              <tr key={player.id} className={`border-t border-line ${ranks.get(player.id)! <= 3 ? "font-bold text-gold" : ""}`}>
                <td className="py-1 pr-2"><input type="checkbox" aria-label={`${player.nickname} 상품 후보`} checked={player.prize} onChange={event => onPrize(player.id, event.target.checked)} /></td>
                <td className="py-1 pr-3 tabular-nums">{ranks.get(player.id)}</td>
                <td className="py-1 pr-3">{player.nickname}</td>
                <td className="py-1 pr-3">{player.name}</td>
                {stage.mode === "team" && <td className="py-1 pr-3">{stage.teams.find(team => team.id === player.teamId)?.name}</td>}
                <td className="py-1 text-right tabular-nums">{player.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
