"use client";

import { useSearchParams } from "next/navigation";
import { useState, useSyncExternalStore, type FormEvent } from "react";
import { GamePad } from "@/components/play/GamePad";
import { ConnectionEnded, GameIcon, Notice, stageGame } from "@/components/shared";
import catalog from "@/content/games.json";
import type { GameMode, Personal, ServerMessage, StageView, TeamInfo } from "@/game/protocol";
import { loadPlayer, savePlayer } from "@/room/storage";
import { secondsLeft, useNow, useRoom } from "@/room/useRoom";

const noSubscribe = () => () => {};
const field = "rounded-xl border border-line bg-night px-4 py-3 text-lg text-snow";
const submit = "rounded-xl bg-gold py-3 text-lg font-bold text-night disabled:opacity-40";

/** 틀린 코드·중복 닉네임은 해당 단계에 머물며 안내만 합니다. */
export function PlayRoom() {
  const code = (useSearchParams().get("room") ?? "").toUpperCase();
  const stored = useSyncExternalStore(noSubscribe, () => loadPlayer(code), () => null);
  const [token, setToken] = useState<string | null>(null);
  const activeToken = token ?? stored;

  const [entryCode, setEntryCode] = useState("");
  const [teams, setTeams] = useState<TeamInfo[] | null>(null);
  const [mode, setMode] = useState<GameMode>("team");
  const [teamId, setTeamId] = useState("");
  const [personal, setPersonal] = useState<Personal | null>(null);
  const [error, setError] = useState("");
  const [fatal, setFatal] = useState("");
  const [motionReady, setMotionReady] = useState(false);

  function handle(message: ServerMessage) {
    switch (message.t) {
      case "entered":
        setTeams(message.teams);
        setMode(message.mode);
        setError("");
        break;
      case "joined":
        savePlayer(code, message.token);
        setToken(message.token);
        setPersonal(message.personal);
        setError("");
        break;
      case "personal":
        setPersonal(message.personal);
        break;
      case "error":
        if (message.code === "BAD_TOKEN") {
          savePlayer(code, null);
          setToken(null);
          setPersonal(null);
        } else if (message.code === "CLOSED") {
          savePlayer(code, null);
        } else if (message.code === "KICKED") {
          savePlayer(code, null);
          setFatal(message.message);
        } else if (message.code === "BAD_TEAM") {
          setTeams(null);
          setError(message.message);
        } else {
          setError(message.message);
        }
        break;
    }
  }

  const { connected, stage, offset, send, ended, reconnect } = useRoom({
    code,
    hello: () => (activeToken ? { t: "resume", token: activeToken } : null),
    onMessage: handle,
  });

  if (!code) return <Notice title="QR을 다시 찍어 주세요" />;
  if (fatal) return <Notice title={fatal} />;
  if (ended === "closed") return <Notice title="게임이 종료되었습니다">참여해 주셔서 감사합니다.</Notice>;
  if (ended) return <ConnectionEnded ended={ended} onRetry={reconnect} />;
  if (activeToken && !personal) return <Notice title="다시 연결하는 중…" />;

  if (!personal) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-5 p-6">
        <h1 className="text-3xl font-black text-gold">{stage?.title ?? catalog.site.name}</h1>
        {error && <p role="alert" className="rounded-lg bg-berry/20 p-3 text-sm">{error}</p>}
        {!connected && <p className="text-sm text-mist">서버에 연결하는 중…</p>}
        {!teams && (
          <CodeStep value={entryCode} onChange={setEntryCode} disabled={!connected} onSubmit={() => { setError(""); send({ t: "enter", entryCode: entryCode.trim() }); }} />
        )}
        {teams && mode === "team" && !teamId && <TeamStep teams={teams} onPick={id => { setError(""); setTeamId(id); }} />}
        {teams && (mode === "solo" || teamId) && (
          <ProfileStep
            team={teams.find(team => team.id === teamId)}
            disabled={!connected}
            onBack={mode === "team" ? () => setTeamId("") : undefined}
            onSubmit={(name, nickname) => { setError(""); send({ t: "join", entryCode: entryCode.trim(), teamId, name, nickname }); }}
          />
        )}
      </main>
    );
  }

  if (!stage) return <Notice title="다시 연결하는 중…" />;
  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2 text-sm">
        <span className="truncate font-bold">{personal.nickname}{stage.mode === "team" && ` · ${stage.teams.find(team => team.id === personal.teamId)?.name}`}</span>
        {!connected && <span className="shrink-0 text-berry">다시 연결 중…</span>}
      </header>
      <div className="min-h-0 flex-1">
        <Phase stage={stage} personal={personal} offset={offset} send={send} motionReady={motionReady} onMotionReady={() => setMotionReady(true)} />
      </div>
    </main>
  );
}

function CodeStep({ value, onChange, disabled, onSubmit }: { value: string; onChange: (value: string) => void; disabled: boolean; onSubmit: () => void }) {
  return (
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(); }} className="flex flex-col gap-3">
      <label className="flex flex-col gap-2 font-bold">
        입장 코드
        <input required autoFocus maxLength={20} autoComplete="off" value={value} onChange={event => onChange(event.target.value)} placeholder="진행자가 알려 준 코드" className={field} />
      </label>
      <button disabled={disabled || !value.trim()} className={submit}>입장하기</button>
    </form>
  );
}

function TeamStep({ teams, onPick }: { teams: TeamInfo[]; onPick: (id: string) => void }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-bold">우리 조를 골라 주세요</h2>
      <div className="grid grid-cols-2 gap-2">
        {teams.map(team => (
          <button key={team.id} onClick={() => onPick(team.id)} className="flex items-center gap-2 rounded-xl border border-line bg-panel p-4 text-left text-lg font-bold">
            <span className="size-4 shrink-0 rounded-full" style={{ background: team.color }} />
            <span className="truncate">{team.name}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProfileStep({ team, disabled, onBack, onSubmit }: { team?: TeamInfo; disabled: boolean; onBack?: () => void; onSubmit: (name: string, nickname: string) => void }) {
  const [name, setName] = useState("");
  const [nickname, setNickname] = useState("");
  return (
    <form onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit(name.trim(), nickname.trim()); }} className="flex flex-col gap-3">
      {team && (
        <p className="flex items-center gap-2 font-bold">
          <span className="size-4 rounded-full" style={{ background: team.color }} />
          {team.name}
          <button type="button" onClick={onBack} className="ml-auto text-sm font-normal text-mist underline">조 다시 고르기</button>
        </p>
      )}
      <label className="flex flex-col gap-1 font-bold">
        이름
        <input required maxLength={20} autoComplete="name" value={name} onChange={event => setName(event.target.value)} className={field} />
      </label>
      <label className="flex flex-col gap-1 font-bold">
        닉네임 <span className="text-xs font-normal text-mist">행사장 화면에 표시돼요</span>
        <input required maxLength={12} autoComplete="off" value={nickname} onChange={event => setNickname(event.target.value)} className={field} />
      </label>
      <button disabled={disabled || !name.trim() || !nickname.trim()} className={submit}>등록하기</button>
    </form>
  );
}

type Send = ReturnType<typeof useRoom>["send"];

function Phase({ stage, personal, offset, send, motionReady, onMotionReady }: { stage: StageView; personal: Personal; offset: number; send: Send; motionReady: boolean; onMotionReady: () => void }) {
  const now = useNow(100);
  const def = stageGame(stage);
  const myTeam = stage.teamRanking.find(row => row.teamId === personal.teamId);

  switch (stage.phase) {
    case "lobby":
    case "select":
      return <Waiting title="입장 완료!" detail={stage.phase === "lobby" ? "곧 게임이 시작돼요." : "진행자가 게임을 고르고 있어요."} />;
    case "rules":
      if (!def) return null;
      return (
        <section className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
          <GameIcon name={def.icon} className="size-20 text-gold" />
          <h2 className="text-3xl font-black">{def.name}</h2>
          <ol className="flex flex-col gap-2 text-mist">{def.rules.map(rule => <li key={rule}>{rule}</li>)}</ol>
          {(def.input === "shake" || def.input === "tilt") && <MotionPermission sensor={def.input === "tilt" ? "orientation" : "motion"} ready={motionReady} onReady={onMotionReady} />}
        </section>
      );
    case "countdown":
      return (
        <section className="flex h-full items-center justify-center">
          <p key={secondsLeft(stage.phaseEndsAt, now, offset)} className="pop text-9xl font-black text-gold">{secondsLeft(stage.phaseEndsAt, now, offset)}</p>
        </section>
      );
    case "playing":
      if (!def || stage.startedAt === null) return null;
      return (
        <GamePad
          key={stage.startedAt}
          def={def}
          seed={stage.seed}
          startedAt={stage.startedAt}
          initialRun={personal.run}
          playerId={personal.playerId}
          offset={offset}
          timeLeft={secondsLeft(stage.phaseEndsAt, now, offset)}
          send={send}
        />
      );
    case "result":
      return (
        <section className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-mist">{def?.name} 결과</p>
          {personal.rank !== null
            ? <p className="text-5xl font-black text-gold">{personal.rank}등 <span className="text-2xl text-mist">/ {personal.ranked}명</span></p>
            : <p className="text-2xl font-bold">이번 게임은 참여하지 않았어요</p>}
          {myTeam && <p className="text-xl">우리 조 {myTeam.rank}등 · +{myTeam.points}점</p>}
          <p className="text-xl">내 누적 {personal.score}점 · 전체 {personal.overallRank}등</p>
        </section>
      );
    case "final": {
      return (
        <section className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <h2 className="text-3xl font-black text-gold">수고하셨습니다!</h2>
          <p className="text-mist">행사장 화면에서 최종 순위를 확인하세요.</p>
          {stage.mode === "team" && <p className="text-xl">우리 조 총 {stage.teams.find(team => team.id === personal.teamId)?.score ?? 0}점</p>}
          <p className="text-2xl font-bold">내 순위 {personal.overallRank}등 · {personal.score}점</p>
        </section>
      );
    }
  }
}

function Waiting({ title, detail }: { title: string; detail: string }) {
  return (
    <section className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <h2 className="text-3xl font-black">{title}</h2>
      <p className="text-mist">{detail}</p>
    </section>
  );
}

type PermissionEvent = { requestPermission?: () => Promise<"granted" | "denied"> };

function MotionPermission({ sensor, ready, onReady }: { sensor: "motion" | "orientation"; ready: boolean; onReady: () => void }) {
  const [message, setMessage] = useState("");
  async function ask() {
    const api = (sensor === "orientation" ? window.DeviceOrientationEvent : window.DeviceMotionEvent) as unknown as PermissionEvent | undefined;
    if (!api) return setMessage("이 폰은 동작 센서를 쓸 수 없어요. 게임 중 버튼을 눌러 주세요.");
    const request = api.requestPermission;
    if (!request) return onReady();
    try {
      if ((await request.call(api)) === "granted") onReady();
      else setMessage("센서가 거부되어 게임 중 버튼을 눌러야 해요.");
    } catch {
      setMessage("센서를 켜지 못했어요. 게임 중 버튼을 눌러 주세요.");
    }
  }
  if (ready) return <p className="font-bold text-gold">센서 준비 완료!</p>;
  return (
    <>
      <button onClick={() => void ask()} className="rounded-xl bg-gold px-6 py-3 font-bold text-night">동작 센서 켜기</button>
      {message && <p className="text-sm text-berry">{message}</p>}
    </>
  );
}
