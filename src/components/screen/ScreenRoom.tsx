"use client";

import { Crown, Footprints, Volume2, VolumeX } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RankingView, RoundResult } from "@/components/screen/NeonBoard";
import { categoryLabel, ConnectionEnded, gameById, GameIcon, games, Notice, QrImage, stageGame } from "@/components/shared";
import { averageLabel, barLength, type GameDef } from "@/game/engine";
import type { StageView, TeamView } from "@/game/protocol";
import { secondsLeft, useNow, useRoom } from "@/room/useRoom";

const noSubscribe = () => () => {};
const TABS = [{ id: "progress", label: "진행" }, { id: "ranking", label: "순위" }] as const;

export function ScreenRoom() {
  const params = useSearchParams();
  const code = params.get("room") ?? "";
  const key = params.get("key") ?? "";
  const [error, setError] = useState("");
  const { stage, offset, connected, ended, reconnect, send } = useRoom({
    code,
    hello: () => (key ? { t: "screen", key } : null),
    onMessage: message => { if (message.t === "error") setError(message.message); },
  });
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const music = useGameMusic(stage, offset);

  if (ended) return <ConnectionEnded ended={ended} onRetry={reconnect} />;
  if (error && !stage) return <Notice title={error} />;
  if (!stage) return <Notice title="화면을 연결하는 중…" />;

  const running = stage.phase === "countdown" || stage.phase === "playing";
  const tab = running ? "progress" : stage.screenTab;
  const url = `${origin}/play/?room=${code}`;

  return (
    <main className="neon-board flex h-dvh flex-col gap-4 overflow-hidden p-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="neon-text neon-flicker flex-1 truncate text-2xl font-black">{stage.title}</h1>
        {!connected && <span className="text-berry">연결 다시 시도 중…</span>}
        <span className="text-mist">{stage.playerCount}명 참가 중</span>
        {music.element}
        <button
          onClick={music.toggle}
          aria-pressed={music.on}
          className={`rounded-lg border px-3 py-1 font-bold ${music.on ? "border-line text-mist" : "border-gold text-gold"}`}
        >
          {music.on ? <><Volume2 aria-hidden className="mr-1 inline size-4" />소리 켜짐</> : <><VolumeX aria-hidden className="mr-1 inline size-4" />소리 켜기</>}
        </button>
        {!running && (
          <nav className="flex gap-1" aria-label="화면 전환">
            {TABS.map(item => (
              <button
                key={item.id}
                aria-pressed={tab === item.id}
                onClick={() => send({ t: "screenTab", tab: item.id })}
                className={`rounded-lg border px-4 py-1 font-bold ${tab === item.id ? "border-gold bg-gold text-night" : "border-line text-mist"}`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        )}
      </header>
      <div className="min-h-0 flex-1">
        {tab === "ranking" && <RankingView stage={stage} />}
        {tab === "progress" && stage.phase === "lobby" && <Lobby stage={stage} url={url} />}
        {tab === "progress" && stage.phase === "select" && <Select stage={stage} url={url} />}
        {tab === "progress" && stage.phase === "rules" && <Rules def={stageGame(stage)!} />}
        {tab === "progress" && stage.phase === "countdown" && <Countdown stage={stage} offset={offset} />}
        {tab === "progress" && stage.phase === "playing" && <Playing stage={stage} offset={offset} />}
        {tab === "progress" && stage.phase === "result" && <RoundResult stage={stage} />}
        {tab === "progress" && stage.phase === "final" && <Final stage={stage} />}
      </div>
    </main>
  );
}

/** 음악이 있는 게임 중 처음 것. 소리 켜기를 누를 때 미리 불러 둡니다. */
const firstMusic = games.find(game => game.music)?.music;

/**
 * 음악은 행사장 화면에서만 틀고 폰은 게임만 보여 줍니다. 게임 시작 순간이 곡의 0초이고, 화면을 늦게 열면 지금 시점부터 이어 틉니다.
 * 브라우저는 사람이 한 번 눌러야 소리를 내므로, 소리 켜기를 누를 때 재생을 한 번 허락받아 둡니다.
 */
function useGameMusic(stage: StageView | null, offset: number) {
  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  const music = (stage && stageGame(stage)?.music) ?? firstMusic;
  const playing = on && stage?.phase === "playing" && stage.startedAt !== null && Boolean(stageGame(stage)?.music);
  const startedAt = stage?.startedAt ?? null;
  useEffect(() => {
    const element = audio.current;
    if (!element) return;
    if (!playing || startedAt === null) {
      element.pause();
      return;
    }
    element.currentTime = Math.max(0, (Date.now() + offset - startedAt) / 1000);
    // 곡 파일이 아직 없거나 재생이 막혀도 게임은 그대로 진행합니다.
    element.play().catch(() => {});
  }, [offset, playing, startedAt]);
  function toggle() {
    const element = audio.current;
    if (!on && element) element.play().then(() => element.pause()).catch(() => {});
    setOn(value => !value);
  }
  const element = music ? <audio ref={audio} src={music.src} preload="auto" /> : null;
  return { on, toggle, element };
}

const sortedByScore = (teams: TeamView[]) => [...teams].sort((a, b) => b.score - a.score);

function Lobby({ stage, url }: { stage: StageView; url: string }) {
  return (
    <div className="grid h-full grid-cols-[auto_minmax(0,1fr)] items-center gap-12 px-8">
      <div className="marquee"><QrImage value={url} size={420} label="참가자 입장 QR" /></div>
      <div className="flex min-w-0 flex-col gap-5">
        <h2 className="text-6xl font-black leading-tight">폰 카메라로<br /><span className="text-gold">QR을 찍어 주세요</span></h2>
        <p className="text-2xl text-mist">진행자가 알려 주는 입장 코드를 넣고, {stage.mode === "team" ? "조와 닉네임을" : "이름과 닉네임을"} 등록하세요.</p>
        <div className="flex flex-wrap gap-2">
          {stage.teams.map(team => (
            <span key={team.id} className="flex items-center gap-2 rounded-full bg-panel px-4 py-2 text-lg">
              <span className="size-3 rounded-full" style={{ background: team.color }} />
              {team.name} <b className="tabular-nums">{team.members}명</b>
            </span>
          ))}
        </div>
        <p className="truncate text-lg text-mist">{stage.recent.join(" · ")}</p>
      </div>
    </div>
  );
}

function Select({ stage, url }: { stage: StageView; url: string }) {
  const available = games.filter(game => stage.gameIds.includes(game.id));
  return (
    <div className="grid h-full grid-cols-[minmax(0,1fr)_290px] gap-4">
      <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-baseline gap-4">
        <h2 className="neon-text flex-1 text-4xl font-black">어떤 게임을 할까요?</h2>
        <span className="text-lg text-mist">{stage.played.length}라운드 완료</span>
      </div>
      <ul className="grid min-h-0 flex-1 auto-rows-fr grid-cols-4 gap-3">
        {available.map(game => {
          const rounds = stage.played.filter(entry => entry.gameId === game.id);
          const last = rounds.at(-1);
          const winner = stage.teams.find(team => team.id === last?.winners[0])?.name ?? last?.mvps[0]?.display;
          return (
            <li key={game.id} className="flex min-h-0 flex-col justify-center overflow-hidden rounded-xl border border-line bg-panel/85 px-4 py-1.5">
              <div className="flex items-center gap-2">
                <GameIcon name={game.icon} className="size-7 shrink-0 text-gold" />
                <div className="min-w-0">
                  <p className="truncate text-xl font-black">{game.name}</p>
                  <p className="text-xs text-mist">{categoryLabel(game.category)} · {stage.durations[game.id] ?? game.durationSec}초</p>
                </div>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-mist">{winner ? `${rounds.length}회 진행 · 최근 1등 ${winner}` : game.summary}</p>
            </li>
          );
        })}
      </ul>
      </div>
      <aside className="flex min-h-0 flex-col gap-3">
        <RoundLog stage={stage} />
        <div className="flex shrink-0 flex-col items-center gap-1 rounded-xl border border-line bg-panel/85 p-2 text-center">
          <p className="text-lg font-black text-gold">늦게 오셨나요? QR로 입장</p>
          <QrImage value={url} size={170} label="늦게 온 분을 위한 입장 QR" />
        </div>
      </aside>
    </div>
  );
}

/** 게임 선택 화면의 진행 내역: 현재 1위와 라운드별 1등. 최근 라운드가 위에 옵니다. */
function RoundLog({ stage }: { stage: StageView }) {
  const bestScore = Math.max(0, ...stage.teams.map(team => team.score));
  const topTeams = bestScore > 0 ? stage.teams.filter(team => team.score === bestScore) : [];
  const topPlayers = stage.leaders.filter(leader => leader.rank === 1 && leader.score > 0);
  const rounds = stage.played.map((played, i) => ({ ...played, round: i + 1 })).reverse();
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-xl border border-line bg-panel/85 p-3">
      <h3 className="text-lg font-black text-gold">진행 내역</h3>
      {stage.played.length === 0 ? <p className="text-mist">아직 진행한 게임이 없어요.</p> : (
        <>
          <dl className="shrink-0 text-sm">
            {stage.mode === "team" && (
              <div className="flex gap-2">
                <dt className="shrink-0 text-mist">조 1위</dt>
                <dd className="truncate font-bold">{topTeams.map(team => team.name).join(", ") || "-"}{bestScore > 0 && ` · ${bestScore}점`}</dd>
              </div>
            )}
            <div className="flex gap-2">
              <dt className="shrink-0 text-mist">개인 1위</dt>
              <dd className="truncate font-bold">{topPlayers.map(leader => leader.display).join(", ") || "-"}{topPlayers[0] && ` · ${topPlayers[0].score}점`}</dd>
            </div>
          </dl>
          <ol className="flex min-h-0 flex-1 flex-col gap-1 overflow-hidden border-t border-line pt-2 text-sm">
            {rounds.map(entry => {
              const winners = stage.mode === "team"
                ? entry.winners.flatMap(id => stage.teams.filter(team => team.id === id).map(team => team.name))
                : entry.mvps.map(player => player.display);
              return (
                <li key={entry.round} className="flex items-baseline gap-2">
                  <span className="shrink-0 tabular-nums text-mist">{entry.round}R</span>
                  <span className="min-w-0 flex-1 truncate">{gameById(entry.gameId)?.name}</span>
                  <span className="max-w-36 shrink-0 truncate font-bold">{winners.join(", ") || "-"}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function Rules({ def }: { def: GameDef }) {
  return (
    <div className="flex h-full items-center justify-center gap-16">
      <GameIcon name={def.icon} className="size-48 text-gold" />
      <div>
        <p className="text-xl text-mist">{categoryLabel(def.category)} · {def.durationSec}초</p>
        <h2 className="my-2 text-7xl font-black">{def.name}</h2>
        <p className="mb-6 text-2xl text-mist">{def.summary}</p>
        <ol className="flex flex-col gap-3 text-2xl">
          {def.rules.map((rule, i) => (
            <li key={rule} className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-gold font-bold text-night">{i + 1}</span>
              {rule}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function Countdown({ stage, offset }: { stage: StageView; offset: number }) {
  const now = useNow(100);
  const left = secondsLeft(stage.phaseEndsAt, now, offset);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <p key={left} className="pop text-[16rem] font-black leading-none text-gold">{left || "GO"}</p>
      <p className="text-2xl text-mist">{gameById(stage.gameId)?.name}</p>
    </div>
  );
}

function Playing({ stage, offset }: { stage: StageView; offset: number }) {
  const now = useNow();
  const def = gameById(stage.gameId)!;
  const ranked = [...stage.teams].sort((a, b) => b.average - a.average);
  const best = ranked[0]?.average ?? 0;
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <GameIcon name={def.icon} className="size-8 text-gold" />
        <h2 className="flex-1 text-3xl font-black">{def.name}</h2>
        <span className="rounded-full bg-gold px-5 py-1 text-3xl font-black tabular-nums text-night">{secondsLeft(stage.phaseEndsAt, now, offset)}</span>
      </div>
      <div className={`grid min-h-0 flex-1 gap-6 ${stage.mode === "team" ? "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" : "grid-cols-1"}`}>
        {stage.mode === "team" && (
          <section className="flex min-h-0 flex-col gap-2">
            <h3 className="text-lg font-bold">조 평균</h3>
            <ul className="flex min-h-0 flex-1 flex-col justify-center gap-2 overflow-hidden">
              {ranked.map(team => (
                <li key={team.id} className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-2">
                  <span className="truncate font-bold">{team.name}</span>
                  <div className="relative h-8 rounded-md bg-black/30">
                    <div className="h-full rounded-md transition-[width] duration-300 ease-linear" style={{ width: `${Math.min(1, barLength(def, team.average, best)) * 100}%`, background: team.color }} />
                    <span className="absolute inset-y-0 left-2 flex items-center text-sm font-bold tabular-nums text-snow [text-shadow:0_0_4px_#000]">{averageLabel(def, team.average)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        <RaceLanes stage={stage} def={def} />
      </div>
    </div>
  );
}

const LANES = 10;
const SOLO_COLOR = "#ffc94d";

/** 실시간 개인 경주: 상위 10명이 점수만큼 달려 나갑니다. 순위가 바뀌면 레인 순서도 바뀝니다. */
function RaceLanes({ stage, def }: { stage: StageView; def: GameDef }) {
  const best = Math.max(0, ...stage.top.map(player => player.value));
  const finish = Boolean(def.goal) || def.kind === "race";
  return (
    <section className="flex min-h-0 flex-col gap-2">
      <h3 className="text-lg font-bold">실시간 개인 TOP {LANES} <span className="text-sm font-normal text-mist">내 등수는 폰에서 확인하세요</span></h3>
      <ol className={`flex min-h-0 flex-1 flex-col justify-around overflow-hidden rounded-xl bg-panel/60 px-3 py-2 ${finish ? "border-r-8 border-dashed border-snow/60" : ""}`}>
        {Array.from({ length: LANES }, (_, i) => {
          const player = stage.top[i];
          if (!player) return <li key={`empty-${i}`} className="h-9 border-b border-dashed border-line/40" />;
          const color = stage.teams.find(team => team.id === player.teamId)?.color ?? SOLO_COLOR;
          const length = Math.min(1, barLength(def, player.value, best));
          return (
            <li key={player.nickname} className="grid grid-cols-[28px_minmax(0,1fr)_72px] items-center gap-2 border-b border-dashed border-line/40">
              <span className="text-right text-lg font-black tabular-nums text-mist">{i + 1}</span>
              <div className="relative h-9">
                <div className="absolute inset-y-3 left-0 rounded-full opacity-40 transition-[width] duration-300 ease-linear" style={{ width: `${length * 100}%`, background: color }} />
                {/* left와 translate를 같은 비율로 두면 이름표가 0%에선 왼쪽 끝, 100%에선 오른쪽 끝에 맞춰 달립니다. */}
                <span
                  className="absolute top-0 flex h-9 max-w-[60%] items-center gap-1 whitespace-nowrap rounded-full px-3 text-sm font-bold text-night transition-all duration-300 ease-linear"
                  style={{ left: `${length * 100}%`, transform: `translateX(-${length * 100}%)`, background: color }}
                >
                  <Footprints aria-hidden className="size-4 shrink-0" />
                  <span className="truncate">{player.display}</span>
                </span>
              </div>
              <span className="text-right text-sm tabular-nums">{player.label}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const REVEAL_MS = 1400;

function Final({ stage }: { stage: StageView }) {
  // 개인전은 개인 TOP 10을 같은 방식으로 발표합니다.
  const teams = stage.mode === "solo"
    ? stage.leaders.map(leader => ({ id: leader.nickname, name: leader.display, color: "#ffc94d", score: leader.score }))
    : sortedByScore(stage.teams);
  // 꼴찌부터 한 조씩 공개하고 마지막에 우승 조를 보여 줍니다.
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= teams.length) return;
    const id = setTimeout(() => setShown(count => count + 1), REVEAL_MS);
    return () => clearTimeout(id);
  }, [shown, teams.length]);
  const champion = teams[0];
  // 동점이면 함께 우승이고 같은 등수로 보여 줍니다.
  const champions = teams.filter(team => team.score === champion?.score);
  const done = shown >= teams.length;
  return (
    <div className={`grid h-full gap-6 ${done ? "grid-cols-2" : "grid-cols-1"}`}>
      {done && champion && (
        <div className="pop flex flex-col items-center justify-center gap-3 rounded-2xl bg-panel">
          <Crown aria-hidden className="size-28 text-gold" />
          <p className="text-2xl text-mist">우승</p>
          <p className="text-center text-7xl font-black" style={{ color: champion.color }}>{champions.map(team => team.name).join(", ")}</p>
          <p className="text-3xl font-bold">{champion.score}점</p>
        </div>
      )}
      <div className="flex min-h-0 flex-col gap-2">
        <h2 className="text-center text-3xl font-black">{done ? "축하합니다!" : "최종 순위 발표"}</h2>
        <ol className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 overflow-hidden">
          {teams.map((team, i) => {
            const visible = teams.length - i <= shown;
            return (
              <li key={team.id} className={`flex items-center gap-3 rounded-lg px-4 py-2 ${visible ? "pop bg-panel" : "bg-panel/40"}`}>
                <span className="w-6 text-mist">{visible ? teams.findIndex(other => other.score === team.score) + 1 : "?"}</span>
                {visible ? (
                  <>
                    <span className="size-3 rounded-full" style={{ background: team.color }} />
                    <span className="flex-1 truncate font-bold">{team.name}</span>
                    <span className="font-bold tabular-nums">{team.score}점</span>
                  </>
                ) : <span className="text-mist">두근두근…</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
