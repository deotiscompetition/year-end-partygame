"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { QrImage } from "@/components/shared";
import type { PublicRoom } from "@/game/protocol";

const REFRESH_MS = 60000;
/** 자동 갱신은 30분 뒤 멈춥니다. 켜 둔 화면이 요청을 계속 만들지 않게 합니다. */
const MAX_REFRESH = 30;
const noSubscribe = () => () => {};

/** 입장할 수 있는 방의 QR. 방이 하나면 크게, 여러 개면 제목과 QR 목록으로 보여 줍니다. */
export function IntroRooms() {
  const [rooms, setRooms] = useState<PublicRoom[]>([]);
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");

  useEffect(() => {
    let active = true;
    let count = 0;
    const load = async () => {
      try {
        const response = await fetch("/api/public/rooms");
        const data = (await response.json()) as { rooms: PublicRoom[] };
        if (active && response.ok) setRooms(data.rooms);
      } catch {
        // 목록을 못 받아도 인사말은 그대로 보여 줍니다.
      }
    };
    void load();
    const id = setInterval(() => {
      if (document.hidden) return;
      count += 1;
      if (count >= MAX_REFRESH) clearInterval(id);
      void load();
    }, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (rooms.length === 0) return null;
  const single = rooms.length === 1;
  return (
    <section
      aria-label="입장 QR"
      className="neon-frame flex min-h-0 shrink-0 flex-col gap-3 overflow-y-auto p-4 md:w-[38%]"
      style={{ "--glow": "#ff2fd0" } as React.CSSProperties}
    >
      <h2 className="neon-text text-center text-2xl font-black">QR을 찍어 입장하세요</h2>
      <ul className={`my-auto grid gap-4 ${single ? "grid-cols-1" : "grid-cols-2"}`}>
        {rooms.map(room => (
          <li key={room.code}>
            <a href={`/play/?room=${room.code}`} className="flex flex-col items-center gap-2 text-center">
              <span className={`line-clamp-2 w-full font-bold break-keep ${single ? "text-2xl" : "text-base"}`}>{room.title}</span>
              <QrImage value={`${origin}/play/?room=${room.code}`} size={single ? 300 : 150} label={`${room.title} 입장 QR`} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
