"use client";

import { useRef, useState, type PointerEvent } from "react";
import { AvatarArt } from "@/components/AvatarArt";
import { AVATAR_PALETTE, AVATAR_SIZE, BLANK_AVATAR } from "@/game/avatar";

type Point = { x: number; y: number };

export function AvatarEditor({ avatar, connected, onSave, onClose }: {
  avatar: string | null; connected: boolean; onSave: (drawing: string | null) => boolean; onClose: () => void;
}) {
  const [drawing, setDrawing] = useState(avatar ?? BLANK_AVATAR);
  const [ink, setInk] = useState(2);
  const pointer = useRef<{ id: number; point: Point } | null>(null);
  const [requested, setRequested] = useState<string | null | undefined>(undefined);
  const nextAvatar = drawing === BLANK_AVATAR ? null : drawing;

  function draw(event: PointerEvent<HTMLDivElement>, first = false) {
    const target = event.currentTarget;
    if (!first && pointer.current?.id !== event.pointerId) return;
    if (first && (pointer.current || event.button !== 0)) return;
    if (first) target.setPointerCapture(event.pointerId);
    const bounds = target.getBoundingClientRect();
    const cell = (fraction: number) => Math.max(0, Math.min(AVATAR_SIZE - 1, Math.floor(fraction * AVATAR_SIZE)));
    const point = { x: cell((event.clientX - bounds.left) / bounds.width), y: cell((event.clientY - bounds.top) / bounds.height) };
    const start = pointer.current?.point ?? point;
    pointer.current = { id: event.pointerId, point };
    const steps = Math.max(1, Math.abs(point.x - start.x), Math.abs(point.y - start.y));
    setDrawing(previous => {
      const pixels = previous.split("");
      for (let i = 0; i <= steps; i += 1) {
        const x = Math.round(start.x + (point.x - start.x) * i / steps);
        const y = Math.round(start.y + (point.y - start.y) * i / steps);
        pixels[y * AVATAR_SIZE + x] = String(ink);
      }
      return pixels.join("");
    });
  }

  return (
    <section className="mx-auto flex h-full w-full max-w-sm flex-col gap-3 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-black">내 캐릭터 그리기</h1>
        <button type="button" className="rounded-lg border border-line px-3 py-2" onClick={onClose}>닫기</button>
      </div>
      <div
        aria-label="캐릭터 그리기 영역" role="img"
        className="relative mx-auto aspect-square w-full max-w-[min(100%,48dvh)] shrink-0 touch-none overflow-hidden rounded-lg bg-[#35384d] ring-1 ring-line"
        style={{ backgroundImage: "linear-gradient(to right,#ffffff18 1px,transparent 1px),linear-gradient(to bottom,#ffffff18 1px,transparent 1px)", backgroundSize: "5% 5%" }}
        onPointerDown={event => draw(event, true)} onPointerMove={event => draw(event)}
        onLostPointerCapture={event => { if (pointer.current?.id === event.pointerId) pointer.current = null; }}
      >
        <AvatarArt avatar={drawing} color="" className="pointer-events-none absolute inset-0 size-full" />
      </div>
      <div className="flex flex-wrap justify-center gap-2" aria-label="그리기 색상" role="group">
        {AVATAR_PALETTE.map(([name, color], index) => (
          <button key={name} type="button" aria-label={name} aria-pressed={ink === index + 1}
            onClick={() => setInk(index + 1)}
            className="size-9 rounded-lg border border-white/30 aria-pressed:ring-2 aria-pressed:ring-snow aria-pressed:ring-offset-2 aria-pressed:ring-offset-night"
            style={{ background: color }} />
        ))}
        <button type="button" aria-pressed={ink === 0} onClick={() => setInk(0)}
          className="rounded-lg border border-line px-2 text-sm aria-pressed:bg-panel">지우개</button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <button type="button" className="rounded-lg border border-line px-3" onClick={() => setDrawing(BLANK_AVATAR)}>비우기</button>
        <button type="button" className="rounded-lg bg-gold py-2 font-bold text-night disabled:opacity-50"
          disabled={!connected || nextAvatar === avatar}
          onClick={() => { if (onSave(nextAvatar)) setRequested(nextAvatar); }}>전광판에 반영</button>
      </div>
      <p role="status" className="min-h-5 text-center text-sm text-mist">
        {requested !== undefined && (requested === avatar ? "전광판에 반영했어요." : "저장 요청을 보냈어요.")}
      </p>
    </section>
  );
}
