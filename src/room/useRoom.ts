"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, StageView } from "@/game/protocol";

function socketUrl(code: string): string {
  const { protocol, hostname, host } = window.location;
  const scheme = protocol === "https:" ? "wss:" : "ws:";
  // 개발 중에는 Next가 아니라 Worker 포트로 바로 연결합니다.
  const port = process.env.NEXT_PUBLIC_GAME_API_PORT;
  return `${scheme}//${port ? `${hostname}:${port}` : host}/api/rooms/${code}/ws`;
}

type Options = {
  code: string;
  /** 연결될 때마다 보낼 인증 메시지. 없으면 아무것도 보내지 않습니다. */
  hello: () => ClientMessage | null;
  onMessage?: (message: ServerMessage) => void;
};

/** 이만큼 연달아 실패하면 재접속을 멈춥니다(약 2분). 켜 둔 탭이 요청을 계속 만들지 않게 합니다. */
const MAX_RETRIES = 20;

export function useRoom({ code, hello, onMessage }: Options) {
  const [connected, setConnected] = useState(false);
  const [ended, setEnded] = useState<"closed" | "lost" | null>(null);
  const [session, setSession] = useState(0);
  const [stage, setStage] = useState<StageView | null>(null);
  const [offset, setOffset] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const handlers = useRef({ hello, onMessage });
  useEffect(() => {
    handlers.current = { hello, onMessage };
  });

  useEffect(() => {
    if (!code) return;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    let best = -Infinity;
    function open() {
      const socket = new WebSocket(socketUrl(code));
      socketRef.current = socket;
      socket.onopen = () => {
        retry = 0;
        setConnected(true);
        const message = handlers.current.hello();
        if (message) socket.send(JSON.stringify(message));
      };
      socket.onmessage = event => {
        const message = JSON.parse(String(event.data)) as ServerMessage;
        if (message.t === "stage") {
          setStage(message.stage);
          // 지연이 가장 작았던 메시지가 서버 시각에 가장 가깝습니다.
          const measured = message.now - Date.now();
          if (measured > best) {
            best = measured;
            setOffset(measured);
          }
        }
        if (message.t === "error" && message.code === "CLOSED") setEnded("closed");
        handlers.current.onMessage?.(message);
      };
      socket.onclose = event => {
        setConnected(false);
        if (closed || event.code === 1000 || event.code === 4001 || event.code === 4002) return;
        if (retry >= MAX_RETRIES) {
          setEnded("lost");
          return;
        }
        // 많은 폰이 한꺼번에 재접속하지 않도록 간격을 흩어 놓습니다.
        const wait = Math.min(8000, 500 * 2 ** retry) * (0.5 + Math.random());
        retry += 1;
        timer = setTimeout(open, wait);
      };
    }
    open();
    return () => {
      closed = true;
      clearTimeout(timer);
      socketRef.current?.close();
    };
  }, [code, session]);

  const reconnect = useCallback(() => {
    setEnded(null);
    setSession(value => value + 1);
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }, []);

  return { connected, stage, offset, send, ended, reconnect };
}

/** 화면 타이머용. 주기적으로 현재 시각을 갱신합니다. */
export function useNow(intervalMs = 200): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function secondsLeft(endsAt: number | null, now: number, offset: number): number {
  return endsAt === null ? 0 : Math.max(0, Math.ceil((endsAt - (now + offset)) / 1000));
}
