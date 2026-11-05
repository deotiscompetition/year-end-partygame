import { Lightbulb, Star } from "lucide-react";
import type { CSSProperties } from "react";
import { IntroRooms } from "@/components/IntroRooms";
import catalog from "@/content/games.json";

const CYAN = "#00e5ff";
const PINK = "#ff2fd0";
const YELLOW = "#ffd400";
/** 글자 수에 맞춰 시간을 정해 문구 길이가 바뀌어도 흐르는 속도가 같습니다. */
const TICKER_SEC_PER_CHAR = 0.32;
const glow = (color: string) => ({ "--glow": color }) as CSSProperties;

export default function IntroPage() {
  const { year, title, welcome, thanks } = catalog.intro;
  const message = thanks.join("   ✦   ");
  const duration = Math.round(message.length * TICKER_SEC_PER_CHAR);
  return (
    <main className="neon-board flex h-dvh flex-col gap-5 overflow-hidden p-5 md:p-8">
      <div className="flex min-h-0 flex-1 flex-col gap-5 md:flex-row">
      <section className="marquee flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center gap-[2vh] text-center">
        <div className="flex items-center gap-4" aria-hidden>
          <Star className="neon-icon size-[6vmin]" style={glow(PINK)} />
          <Lightbulb className="neon-icon neon-flicker size-[10vmin]" style={glow(YELLOW)} />
          <Star className="neon-icon size-[6vmin]" style={glow(CYAN)} />
        </div>
        <h1 className="flex flex-col gap-[1.5vh] font-black leading-tight break-keep">
          <span className="neon-text text-[6vmin]" style={glow(CYAN)}>{year}</span>
          <span className="neon-text text-[8vmin]" style={glow(PINK)}>{title}</span>
          <span className="neon-text neon-flicker text-[8vmin]" style={glow(YELLOW)}>{welcome}</span>
        </h1>
      </section>
      <IntroRooms />
      </div>
      <section className="neon-frame shrink-0 overflow-hidden py-[2vh]" style={glow(CYAN)} aria-label="감사 인사">
        <p className="sr-only">{thanks.join(" ")}</p>
        <div className="ticker neon-text text-[7vmin] font-black" style={{ ...glow(YELLOW), animationDuration: `${duration}s` }} aria-hidden>
          {/* 같은 문구 두 벌을 이어 붙여 끊김 없이 반복합니다. */}
          <span>{message}</span>
          <span className="ticker-copy">{message}</span>
        </div>
      </section>
    </main>
  );
}
