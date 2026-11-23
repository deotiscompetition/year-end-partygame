"use client";

import { Accessibility } from "lucide-react";
import { memo, useEffect, useRef } from "react";
import { AVATAR_PALETTE, AVATAR_SIZE } from "@/game/avatar";

export const AvatarArt = memo(function AvatarArt({ avatar, color, className }: {
  avatar: string | null; color: string; className: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!avatar || !context) return;
    context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
    for (let cell = 0; cell < avatar.length; cell += 1) {
      const paint = AVATAR_PALETTE[Number(avatar[cell]) - 1];
      if (!paint) continue;
      context.fillStyle = paint[1];
      context.fillRect(cell % AVATAR_SIZE, Math.floor(cell / AVATAR_SIZE), 1, 1);
    }
  }, [avatar]);

  return avatar
    ? <canvas aria-hidden ref={canvas} width={AVATAR_SIZE} height={AVATAR_SIZE} className={className} style={{ imageRendering: "pixelated" }} />
    : <Accessibility aria-hidden className={className} style={{ color }} strokeWidth={2.4} />;
});
