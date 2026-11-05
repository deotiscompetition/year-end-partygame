"use client";

import { useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { RoundStats } from "@/components/admin/RoundStats";
import { categoryLabel, ConnectionEnded, gameById, GameIcon, games, Notice, PHASE_LABELS, QrImage } from "@/components/shared";
import catalog from "@/content/games.json";
import { MAX_DURATION_SEC, MIN_DURATION_SEC, type PlayerSummary, type ServerMessage, type StageView } from "@/game/protocol";
import { loadAdmin } from "@/room/storage";
import { secondsLeft, useNow, useRoom } from "@/room/useRoom";

const noSubscribe = () => () => {};
const useOrigin = () => useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");

const button = "rounded-lg bg-gold px-4 py-2 font-bold text-night disabled:opacity-40";
const quiet = "rounded-lg border border-line px-4 py-2 font-bold";
const panel = "rounded-2xl border border-line bg-panel p-5";

type AdminInfo = Extract<ServerMessage, { t: "admin" }>;

export function AdminRoom() {
  const code = useSearchParams().get("room") ?? "";
  const token = useSyncExternalStore(noSubscribe, () => loadAdmin(code), () => null);
  const [info, setInfo] = useState<AdminInfo | null>(null);
  const [error, setError] = useState("");
  const { connected, stage, offset, send, ended, reconnect } = useRoom({
    code: token ? code : "",
    hello: () => (token ? { t: "admin", token } : null),
    onMessage: message => {
      if (message.t === "admin") setInfo(message);
      if (message.t === "error") setError(message.message);
      if (message.t === "stage") setError("");
    },
  });

  if (!token) return <Notice title="관리자 권한이 없어요"><a href="/backstage/" className="underline">방 목록</a>에서 이 방의 관리 버튼으로 열어 주세요.</Notice>;
  if (ended) return <ConnectionEnded ended={ended} onRetry={reconnect} />;
  if (!stage || !info) return <Notice title="연결하는 중…">{error}</Notice>;

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      <AdminBody code={code} stage={stage} info={info} offset={offset} send={send} connected={connected} error={error} />
    </main>
  );
}

const TABS = [
  { id: "progress", label: "진행" },
  { id: "players", label: "참가자" },
  { id: "stats", label: "통계" },
  { id: "settings", label: "설정" },
] as const;
type TabId = (typeof TABS)[number]["id"];

function AdminBody({ code, stage, info, offset, send, connected, error }: { code: string; stage: StageView; info: AdminInfo; offset: number; send: Send; connected: boolean; error: string }) {
  // 입장 코드를 아직 정하지 않았으면 설정부터 보여 줍니다.
  const [tab, setTab] = useState<TabId>(info.entryCode ? "progress" : "settings");
  const now = useNow();
  const origin = useOrigin();
  const def = gameById(stage.gameId);
  const running = stage.phase === "countdown" || stage.phase === "playing";
  const count: Partial<Record<TabId, number>> = { players: stage.playerCount, stats: info.rounds.length };

  return (
    <>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex-1 text-2xl font-black text-gold">{stage.title} <span className="text-base font-normal text-mist">방 {code}</span></h1>
        <a href="/backstage/" className="text-sm text-mist underline">방 목록</a>
        <a href={`/screen/?room=${code}&key=${info.screenKey}`} target="_blank" rel="noreferrer" className={button}>행사장 화면 열기</a>
        <p className={`w-full text-right ${connected ? "text-sm text-mist" : "text-sm text-berry"}`} role="status">
          {connected ? <>{PHASE_LABELS[stage.phase]}{def && ` · ${def.name}`}{running && <b className="ml-1 text-gold">{secondsLeft(stage.phaseEndsAt, now, offset)}초</b>}</> : "연결 끊김, 다시 연결하는 중…"}
        </p>
      </header>
      <nav className="flex gap-1 border-b border-line" aria-label="관리자 메뉴">
        {TABS.map(item => (
          <button
            key={item.id}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
            className={`-mb-px border-b-2 px-4 py-2 font-bold ${tab === item.id ? "border-gold text-gold" : "border-transparent text-mist"}`}
          >
            {item.label}{count[item.id] ? ` ${count[item.id]}` : ""}
          </button>
        ))}
      </nav>
      {error && <p role="alert" className="rounded-lg bg-berry/20 p-3 text-sm">{error}</p>}
      {/* 탭을 옮겨도 입력 중인 설정이 지워지지 않게 화면에서만 숨깁니다. */}
      <div className={tab === "progress" ? "flex flex-col gap-4" : "hidden"}>
        <Controls stage={stage} offset={offset} send={send} />
        <ScreenSwitch stage={stage} send={send} />
      </div>
      <div className={tab === "players" ? "" : "hidden"}>
        <Players stage={stage} players={info.players} onKick={playerId => send({ t: "kick", playerId })} />
      </div>
      <div className={tab === "stats" ? "" : "hidden"}>
        <RoundStats stage={stage} rounds={info.rounds} players={info.players} onPrize={(playerId, on) => send({ t: "prize", playerId, on })} onReset={() => send({ t: "resetScores" })} />
      </div>
      <div className={tab === "settings" ? "grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_340px]" : "hidden"}>
        <SetupForm stage={stage} entryCode={info.entryCode} send={send} />
        <section className={panel}>
          <h2 className="mb-2 font-bold">행사장 화면 주소</h2>
          <p className="mb-2 text-sm text-mist">행사장 컴퓨터 브라우저에 입력하면 QR과 게임 화면이 나옵니다.</p>
          <CopyField value={`${origin}/screen/?room=${code}&key=${info.screenKey}`} />
          <h2 className="mb-2 mt-4 font-bold">참가자 입장 QR</h2>
          <div className="flex items-center gap-3">
            <QrImage value={`${origin}/play/?room=${code}`} size={120} label="참가자 입장 QR" />
            <div className="min-w-0 flex-1"><CopyField value={`${origin}/play/?room=${code}`} /></div>
          </div>
        </section>
      </div>
    </>
  );
}

/** 행사장 화면을 원격으로 바꿉니다. 게임 중에는 진행 화면을 유지합니다. */
function ScreenSwitch({ stage, send }: { stage: StageView; send: Send }) {
  const running = stage.phase === "countdown" || stage.phase === "playing";
  return (
    <section className={`${panel} flex flex-wrap items-center gap-3`}>
      <h2 className="flex-1 font-bold">행사장 화면 {running && <span className="text-sm font-normal text-mist">게임 중에는 진행 화면으로 고정돼요</span>}</h2>
      <button className={stage.screenTab === "progress" || running ? button : quiet} aria-pressed={stage.screenTab === "progress"} disabled={running} onClick={() => send({ t: "screenTab", tab: "progress" })}>진행 보기</button>
      <button className={stage.screenTab === "ranking" && !running ? button : quiet} aria-pressed={stage.screenTab === "ranking"} disabled={running} onClick={() => send({ t: "screenTab", tab: "ranking" })}>순위 보기</button>
    </section>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={value} aria-label="주소" className="min-w-0 flex-1 rounded-lg border border-line bg-night px-2 py-1 text-xs" />
      <button
        type="button"
        className="shrink-0 rounded-lg border border-line px-2 text-sm"
        onClick={() => void navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
      >
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}

type Send = ReturnType<typeof useRoom>["send"];

function SetupForm({ stage, entryCode, send }: { stage: StageView; entryCode: string; send: Send }) {
  const [title, setTitle] = useState(stage.title);
  const [mode, setMode] = useState(stage.mode);
  const [gameIds, setGameIds] = useState(stage.gameIds);
  const [seconds, setSeconds] = useState<Record<string, string>>(() =>
    Object.fromEntries(games.map(game => [game.id, String(stage.durations[game.id] ?? game.durationSec)])));
  const [code, setCode] = useState(entryCode);
  const [teams, setTeams] = useState((stage.teams.length ? stage.teams.map(team => team.name) : catalog.site.defaultTeams).join("\n"));
  const [saved, setSaved] = useState(false);
  const names = teams.split("\n").map(name => name.trim()).filter(Boolean);

  // 순간 포착은 시간이 고정이라 시간 입력을 받지 않습니다.
  const timed = (id: string) => games.find(game => game.id === id)?.kind !== "reflex";
  const validSeconds = (value: string) => Number.isInteger(Number(value)) && Number(value) >= MIN_DURATION_SEC && Number(value) <= MAX_DURATION_SEC;
  const secondsOk = gameIds.every(id => !timed(id) || validSeconds(seconds[id]));
  const running = stage.phase === "countdown" || stage.phase === "playing";

  function save(event: FormEvent) {
    event.preventDefault();
    const durations = Object.fromEntries(gameIds.filter(timed).map(id => [id, Number(seconds[id])]));
    if (send({ t: "setup", title: title.trim(), mode, entryCode: code.trim(), teams: mode === "team" ? names : [], gameIds, durations })) {
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  return (
    <form onSubmit={save} className={`${panel} flex flex-col gap-3`}>
      <h2 className="font-bold">방 설정</h2>
      <label className="flex flex-col gap-1 text-sm text-mist">
        방 이름 (화면 위쪽에 표시돼요)
        <input required maxLength={30} value={title} onChange={event => setTitle(event.target.value)} className="rounded-lg border border-line bg-night px-3 py-2 text-base text-snow" />
      </label>
      <fieldset className="flex flex-col gap-1 text-sm" disabled={stage.playerCount > 0}>
        <legend className="mb-1 text-mist">진행 방식{stage.playerCount > 0 && " (참가자가 입장해 바꿀 수 없어요)"}</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "team"} onChange={() => setMode("team")} />조 대항전</label>
          <label className="flex items-center gap-2"><input type="radio" name="mode" checked={mode === "solo"} onChange={() => setMode("solo")} />개인전 (조 없음)</label>
        </div>
      </fieldset>
      <label className="flex flex-col gap-1 text-sm text-mist">
        입장 코드 (행사장에서 말로 안내하세요)
        <input required maxLength={20} value={code} onChange={event => setCode(event.target.value)} className="rounded-lg border border-line bg-night px-3 py-2 text-lg text-snow" />
      </label>
      {mode === "team" && (
        <label className="flex flex-col gap-1 text-sm text-mist">
          팀(조) 목록, 한 줄에 하나씩
          <textarea required rows={6} value={teams} onChange={event => setTeams(event.target.value)} className="rounded-lg border border-line bg-night px-3 py-2 text-base text-snow" />
        </label>
      )}
      <fieldset className="flex flex-col gap-1 text-sm">
        <legend className="mb-1 text-mist">사용할 게임과 제한 시간(초, {MIN_DURATION_SEC}~{MAX_DURATION_SEC}) · {gameIds.length}/{games.length}개 선택</legend>
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {games.map(game => (
            <div key={game.id} className="flex items-center gap-2">
              <label className="flex flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={gameIds.includes(game.id)}
                  onChange={event => setGameIds(event.target.checked ? [...gameIds, game.id] : gameIds.filter(id => id !== game.id))}
                />
                {game.name}
              </label>
              {timed(game.id) ? (
                <input
                  type="number"
                  aria-label={`${game.name} 제한 시간(초)`}
                  min={MIN_DURATION_SEC}
                  max={MAX_DURATION_SEC}
                  disabled={!gameIds.includes(game.id)}
                  value={seconds[game.id]}
                  onChange={event => setSeconds({ ...seconds, [game.id]: event.target.value })}
                  className="w-16 rounded border border-line bg-night px-1 py-0.5 text-right disabled:opacity-40"
                />
              ) : <span className="w-16 text-right text-xs text-mist">고정</span>}
            </div>
          ))}
        </div>
      </fieldset>
      <div className="flex items-center gap-3">
        <button className={button} disabled={running || !title.trim() || !code.trim() || (mode === "team" && (names.length === 0 || names.some(name => name.length > 12))) || gameIds.length === 0 || !secondsOk}>저장</button>
        {running && <span className="text-sm text-mist">게임이 끝나면 저장할 수 있어요</span>}
        {saved && <span className="text-sm text-mist">저장했어요</span>}
        {!entryCode && <span className="text-sm text-gold">저장해야 참가자가 입장할 수 있어요</span>}
      </div>
    </form>
  );
}

function Controls({ stage, offset, send }: { stage: StageView; offset: number; send: Send }) {
  const now = useNow();
  const def = gameById(stage.gameId);
  const available = games.filter(game => stage.gameIds.includes(game.id));
  return (
    <section className={panel}>
      {stage.phase === "lobby" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1 text-mist">참가자가 다 들어오면 시작하세요. 늦게 온 분도 언제든 입장할 수 있어요.</p>
          <button className={button} disabled={stage.mode === "team" && stage.teams.length === 0} onClick={() => send({ t: "openSelect" })}>게임 고르러 가기</button>
        </div>
      )}
      {stage.phase === "select" && (
        <>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-bold">게임 선택 ({stage.played.length}라운드 완료 · 같은 게임을 다시 해도 돼요)</h2>
            <button className={quiet} disabled={stage.played.length === 0} onClick={() => send({ t: "finish" })}>최종 발표</button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {available.map(game => {
              const count = stage.played.filter(entry => entry.gameId === game.id).length;
              return (
                <button key={game.id} onClick={() => send({ t: "pick", gameId: game.id })} className="flex items-center gap-2 rounded-lg border border-line p-2 text-left text-sm hover:border-gold">
                  <GameIcon name={game.icon} className="size-5 shrink-0 text-gold" />
                  <span className="min-w-0"><span className="block font-bold">{game.name}</span><span className="text-xs text-mist">{categoryLabel(game.category)}{count > 0 && ` · ${count}회 진행`}</span></span>
                </button>
              );
            })}
          </div>
        </>
      )}
      {stage.phase === "rules" && def && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1"><b>{def.name}</b> 룰을 안내하는 중이에요.</p>
          <button className={quiet} onClick={() => send({ t: "openSelect" })}>다른 게임</button>
          <button className={button} onClick={() => send({ t: "start" })}>시작!</button>
        </div>
      )}
      {stage.phase === "countdown" && <p>곧 시작합니다… {secondsLeft(stage.phaseEndsAt, now, offset)}</p>}
      {stage.phase === "playing" && def && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1"><b>{def.name}</b> 진행 중 · 남은 시간 {secondsLeft(stage.phaseEndsAt, now, offset)}초</p>
          <button className={quiet} onClick={() => send({ t: "endGame" })}>지금 끝내기</button>
        </div>
      )}
      {stage.phase === "result" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1"><b>{def?.name}</b> 결과를 보여 주는 중이에요.</p>
          <button className={quiet} onClick={() => send({ t: "finish" })}>최종 발표</button>
          {stage.gameId && <button className={quiet} onClick={() => send({ t: "pick", gameId: stage.gameId! })}>같은 게임 다시</button>}
          <button className={button} onClick={() => send({ t: "openSelect" })}>다음 게임</button>
        </div>
      )}
      {stage.phase === "final" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="flex-1">최종 순위를 발표했어요. 게임을 더 해도 점수는 이어져요.</p>
          <button className={button} onClick={() => send({ t: "openSelect" })}>게임 더 하기</button>
        </div>
      )}
    </section>
  );
}

function Players({ stage, players, onKick }: { stage: StageView; players: PlayerSummary[]; onKick: (id: string) => void }) {
  return (
    <section className={panel}>
      <h2 className="mb-3 font-bold">참가자 ({stage.playerCount}명)</h2>
      <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
        {stage.mode === "solo" && (
          <ul className="flex flex-col text-sm">
            {players.map(player => (
              <li key={player.id} className="flex items-center justify-between py-0.5">
                <span className={player.online ? "" : "text-mist"}>{player.nickname} <span className="text-xs text-mist">({player.name})</span></span>
                {stage.phase === "lobby" && <button className="text-xs text-berry" aria-label={`${player.nickname} 내보내기`} onClick={() => onKick(player.id)}>내보내기</button>}
              </li>
            ))}
          </ul>
        )}
        {stage.teams.map(team => (
          <div key={team.id}>
            <h3 className="mb-1 flex items-center gap-2 text-sm font-bold">
              <span className="size-3 rounded-full" style={{ background: team.color }} />
              {team.name} <span className="font-normal text-mist">{team.online}/{team.members}명 접속 · {team.score}점</span>
            </h3>
            <ul className="flex flex-col text-sm">
              {players.filter(player => player.teamId === team.id).map(player => (
                <li key={player.id} className="flex items-center justify-between py-0.5">
                  <span className={player.online ? "" : "text-mist"}>{player.nickname} <span className="text-xs text-mist">({player.name})</span></span>
                  {stage.phase === "lobby" && <button className="text-xs text-berry" aria-label={`${player.nickname} 내보내기`} onClick={() => onKick(player.id)}>내보내기</button>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
