"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PHASE_LABELS } from "@/components/shared";
import catalog from "@/content/games.json";
import type { RoomEntry } from "@/game/protocol";
import { saveAdmin } from "@/room/storage";

const REFRESH_MS = 30000;
/** 자동 갱신은 15분 뒤 멈춥니다. 켜 둔 탭이 요청을 계속 만들지 않게 합니다. */
const MAX_AUTO_REFRESH = 30;
const ERRORS: Record<string, string> = {
  BAD_PASSWORD: "비밀번호가 맞지 않아요.",
  RATE_LIMITED: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
  ADMIN_PASSWORD_NOT_SET: "서버에 관리자 비밀번호가 등록되지 않았어요.",
};
const field = "rounded-lg border border-line bg-night px-3 py-2 text-base text-snow";
const panel = "rounded-2xl border border-line bg-panel p-5";

async function post<T>(path: string, body: object): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(ERRORS[data.error ?? ""] ?? "요청을 처리하지 못했어요.");
  return data;
}

export function Dashboard() {
  // 비밀번호는 저장하지 않습니다. 새로고침하면 다시 입력합니다.
  const [password, setPassword] = useState("");
  const [rooms, setRooms] = useState<RoomEntry[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await post<{ rooms: RoomEntry[] }>("/api/dashboard", { password });
      setRooms(data.rooms);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "서버에 연결하지 못했어요.");
    }
  }, [password]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    await load();
    setBusy(false);
  }

  if (!rooms) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 p-6">
        <header>
          <h1 className="text-4xl font-black text-gold">{catalog.site.name}</h1>
          <p className="mt-2 text-mist">{catalog.site.tagline}</p>
        </header>
        <form onSubmit={login} className={`${panel} flex flex-col gap-3`}>
          <h2 className="text-lg font-bold">관리자 대시보드</h2>
          <label className="flex flex-col gap-1 text-sm text-mist">
            관리자 비밀번호
            <input type="password" required autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} className={field} />
          </label>
          {error && <p role="alert" className="text-sm text-berry">{error}</p>}
          <button disabled={busy} className="rounded-lg bg-gold py-3 font-bold text-night disabled:opacity-50">{busy ? "확인 중…" : "들어가기"}</button>
        </form>
        <p className="text-center text-sm text-mist">참가자는 행사장 화면의 QR을 폰 카메라로 찍어 주세요.</p>
      </main>
    );
  }
  return <RoomList rooms={rooms} password={password} error={error} onRefresh={load} />;
}

function RoomList({ rooms, password, error, onRefresh }: { rooms: RoomEntry[]; password: string; error: string; onRefresh: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [autoPaused, setAutoPaused] = useState(false);
  const [autoSession, setAutoSession] = useState(0);

  useEffect(() => {
    let count = 0;
    const id = setInterval(() => {
      if (document.hidden) return;
      count += 1;
      if (count > MAX_AUTO_REFRESH) {
        setAutoPaused(true);
        clearInterval(id);
        return;
      }
      void onRefresh();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [onRefresh, autoSession]);

  function refreshNow() {
    setAutoPaused(false);
    setAutoSession(value => value + 1);
    void onRefresh();
  }

  async function closeRoom(room: RoomEntry) {
    if (!window.confirm(`방 ${room.code}(${room.title})을 닫을까요?\n접속이 모두 끊기고 통계와 개인 순위도 삭제됩니다.`)) return;
    setCreateError("");
    try {
      await post(`/api/rooms/${room.code}/close`, { password });
      await onRefresh();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "방을 닫지 못했어요.");
    }
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const room = await post<{ code: string; adminToken: string }>("/api/rooms", { password, title });
      saveAdmin(room.code, room.adminToken);
      setTitle("");
      await onRefresh();
    } catch (cause) {
      setCreateError(cause instanceof Error ? cause.message : "방을 만들지 못했어요.");
    } finally {
      setCreating(false);
    }
  }

  const stats = [
    { label: "생성된 방", value: rooms.length },
    { label: "진행 중인 방", value: rooms.filter(room => room.phase !== "final" && room.phase !== "lobby").length },
    { label: "참가자 합계", value: rooms.reduce((sum, room) => sum + room.players, 0) },
    { label: "완료한 라운드", value: rooms.reduce((sum, room) => sum + room.rounds, 0) },
  ];

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-black text-gold">관리자 대시보드</h1>
        <button onClick={refreshNow} className="rounded-lg border border-line px-3 py-1 text-sm">새로고침</button>
      </header>
      {error && <p role="alert" className="rounded-lg bg-berry/20 p-3 text-sm">{error}</p>}
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map(stat => (
          <li key={stat.label} className={panel}>
            <p className="text-sm text-mist">{stat.label}</p>
            <p className="text-4xl font-black tabular-nums">{stat.value}</p>
          </li>
        ))}
      </ul>
      <form onSubmit={create} className={`${panel} flex flex-wrap items-end gap-3`}>
        <label className="flex min-w-48 flex-1 flex-col gap-1 text-sm text-mist">
          새 방 이름
          <input maxLength={30} value={title} onChange={event => setTitle(event.target.value)} placeholder="예: 2026 송년회" className={field} />
        </label>
        <button disabled={creating} className="rounded-lg bg-gold px-5 py-2.5 font-bold text-night disabled:opacity-50">{creating ? "만드는 중…" : "방 만들기"}</button>
        {createError && <p role="alert" className="w-full text-sm text-berry">{createError}</p>}
      </form>
      <section className={`${panel} overflow-x-auto`}>
        <h2 className="mb-3 font-bold">방 목록</h2>
        {rooms.length === 0 ? <p className="text-mist">아직 만든 방이 없어요.</p> : (
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-mist">
              <tr>
                {["코드", "이름", "상태", "참가자", "방식", "라운드", "만든 시각", "열기"].map(label => <th key={label} scope="col" className="py-2 pr-3 font-normal">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rooms.map(room => (
                <tr key={room.code} className="border-t border-line">
                  <td className="py-2 pr-3 font-mono font-bold">{room.code}</td>
                  <td className="py-2 pr-3">{room.title}</td>
                  <td className="py-2 pr-3">{PHASE_LABELS[room.phase]}</td>
                  <td className="py-2 pr-3 tabular-nums">{room.players}명</td>
                  <td className="py-2 pr-3 tabular-nums">{room.mode === "solo" ? "개인전" : `${room.teams}개 조`}</td>
                  <td className="py-2 pr-3 tabular-nums">{room.rounds}</td>
                  <td className="py-2 pr-3 text-mist">{new Date(room.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="flex gap-2 py-2">
                    <a href={`/backstage/?room=${room.code}`} target="_blank" rel="noreferrer" onClick={() => saveAdmin(room.code, room.adminToken)} className="rounded border border-gold px-2 py-0.5 font-bold text-gold">관리</a>
                    <a href={`/screen/?room=${room.code}&key=${room.screenKey}`} target="_blank" rel="noreferrer" className="rounded border border-line px-2 py-0.5">행사장 화면</a>
                    <button onClick={() => void closeRoom(room)} className="rounded border border-berry px-2 py-0.5 text-berry">닫기</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-mist">
          관리자 조작·입장·게임 입력이 3시간 동안 없으면 방이 자동으로 닫히고 통계도 지워져요. 상품 확인은 그 전에 해 주세요.{" "}
          {autoPaused ? <b className="text-gold">자동 갱신을 멈췄어요. 새로고침을 누르면 다시 시작해요.</b> : "목록은 이 탭을 보는 동안 30초마다 갱신돼요(15분 후 멈춤)."}
        </p>
      </section>
    </main>
  );
}
