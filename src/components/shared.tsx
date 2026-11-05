"use client";

import {
  ArrowLeftRight, Brain, Calculator, Footprints, Grid3x3, Hammer, LockKeyhole, MoveHorizontal, Palette, Piano, Pointer, Scale, Scissors, Thermometer, Vibrate, X, Zap,
  type LucideIcon,
} from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import catalog from "@/content/games.json";
import type { GameDef } from "@/game/engine";
import { withDuration, type Phase, type StageView } from "@/game/protocol";

export const games = catalog.games as GameDef[];
export const gameById = (id: string | null) => games.find(game => game.id === id);
/** 관리자가 정한 시간까지 반영한 현재 게임 */
export function stageGame(stage: StageView): GameDef | undefined {
  const def = gameById(stage.gameId);
  return def && withDuration(def, stage.durations);
}

export const PHASE_LABELS: Record<Phase, string> = {
  lobby: "입장 대기",
  select: "게임 선택",
  rules: "룰 안내",
  countdown: "시작 직전",
  playing: "게임 중",
  result: "라운드 결과",
  final: "종료",
};

const ICONS: Record<string, LucideIcon> = {
  ArrowLeftRight, Brain, Calculator, Footprints, Grid3x3, Hammer, LockKeyhole, MoveHorizontal, Palette, Piano, Pointer, Scale, Scissors, Thermometer, Vibrate, X, Zap,
};

export function GameIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICONS[name] ?? Pointer;
  return <Icon aria-hidden className={className} />;
}

export const categoryLabel = (category: string) => (category === "speed" ? "순발력" : "두뇌");

export function QrImage({ value, size, label }: { value: string; size: number; label: string }) {
  const [source, setSource] = useState("");
  useEffect(() => {
    let active = true;
    if (value) void QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: "M" }).then(url => { if (active) setSource(url); });
    return () => { active = false; };
  }, [value, size]);
  if (!source) return <div style={{ width: size, height: size }} className="rounded-xl bg-white/10" />;
  // eslint-disable-next-line @next/next/no-img-element -- 브라우저에서 만든 data URL입니다.
  return <img src={source} width={size} height={size} alt={label} className="rounded-xl bg-white" />;
}

/** 방이 닫혔거나 재접속을 멈춘 화면. 다시 연결은 사용자가 눌렀을 때만 시도합니다. */
export function ConnectionEnded({ ended, onRetry }: { ended: "closed" | "lost"; onRetry: () => void }) {
  if (ended === "closed") return <Notice title="방이 닫혔어요">사용하지 않거나 관리자가 닫은 방이에요.</Notice>;
  return (
    <Notice title="연결이 끊겼어요">
      <button onClick={onRetry} className="mt-2 rounded-lg bg-gold px-5 py-2 font-bold text-night">다시 연결</button>
    </Notice>
  );
}

export function Notice({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      {children && <div className="text-mist">{children}</div>}
    </main>
  );
}
