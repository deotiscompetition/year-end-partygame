import Link from "next/link";
import type { CSSProperties } from "react";

export default function NotFound() {
  return (
    <main className="neon-board flex h-dvh p-5 md:p-8">
      <section className="marquee flex flex-1 flex-col items-center justify-center gap-6 text-center">
        <h1 className="neon-text neon-flicker text-[24vmin] font-black leading-none" style={{ "--glow": "#ff2fd0" } as CSSProperties}>404</h1>
        <p className="neon-text text-[5vmin] font-bold" style={{ "--glow": "#00e5ff" } as CSSProperties}>페이지를 찾을 수 없어요</p>
        <Link href="/" className="rounded-xl bg-gold px-8 py-3 text-xl font-black text-night">홈으로 가기</Link>
      </section>
    </main>
  );
}
