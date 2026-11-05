import type { PublicRoom } from "../src/game/protocol";
import { Registry } from "./registry";
import { Room, type Env } from "./room";

export { Registry, Room };

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_TITLE = 30;
const DEFAULT_TITLE = "연말 대항전";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return [...bytes].map(b => ALPHABET[b % ALPHABET.length]).join("");
}

/** 다른 사이트에서 방을 만들거나 접속하지 못하게 합니다. 로컬 개발에서는 폰 테스트를 위해 열어 둡니다. */
function allowedOrigin(request: Request, env: Env): boolean {
  if (env.ENVIRONMENT !== "production") return true;
  const origin = request.headers.get("Origin");
  return origin !== null && new URL(origin).host === new URL(request.url).host;
}

async function samePassword(a: string, b: string): Promise<boolean> {
  const hash = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  const [left, right] = await Promise.all([hash(a), hash(b)]);
  return left.every((byte, i) => byte === right[i]);
}

type AdminBody = { password?: unknown; title?: unknown };

/** 관리자 요청 확인. 통과하면 본문을, 아니면 오류 응답을 돌려줍니다. */
async function authorize(request: Request, env: Env): Promise<AdminBody | Response> {
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const { success } = await env.ADMIN_LIMIT.limit({ key: ip });
  if (!success) return json({ error: "RATE_LIMITED" }, 429);
  // 비밀번호를 등록하지 않은 운영 환경에서는 아무도 관리자 기능을 쓸 수 없습니다.
  if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD_NOT_SET" }, 503);
  const body = await request.json<AdminBody>().catch(() => null);
  if (typeof body?.password !== "string" || !(await samePassword(body.password, env.ADMIN_PASSWORD))) return json({ error: "BAD_PASSWORD" }, 401);
  return body;
}

const PUBLIC_ROOMS_CACHE_MS = 20000;
let publicRooms: { at: number; rooms: PublicRoom[] } | null = null;

/** 인트로 페이지용 공개 목록. 인증이 없으므로 코드·이름만 내보내고, 잠깐 보관해 방 목록 조회를 줄입니다. */
async function listPublicRooms(env: Env): Promise<PublicRoom[]> {
  if (publicRooms && Date.now() - publicRooms.at < PUBLIC_ROOMS_CACHE_MS) return publicRooms.rooms;
  const entries = await env.REGISTRY.get(env.REGISTRY.idFromName("main")).list();
  const rooms = entries.filter(entry => entry.ready && entry.phase !== "final").map(({ code, title }) => ({ code, title }));
  publicRooms = { at: Date.now(), rooms };
  return rooms;
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/ready") return json({ ok: true });
    if (url.pathname === "/api/public/rooms" && request.method === "GET") return json({ rooms: await listPublicRooms(env) });
    if (!allowedOrigin(request, env)) return json({ error: "FORBIDDEN" }, 403);

    if (url.pathname === "/api/dashboard" && request.method === "POST") {
      const auth = await authorize(request, env);
      if (auth instanceof Response) return auth;
      return json({ rooms: await env.REGISTRY.get(env.REGISTRY.idFromName("main")).list() });
    }

    if (url.pathname === "/api/rooms" && request.method === "POST") {
      const auth = await authorize(request, env);
      if (auth instanceof Response) return auth;
      const title = typeof auth.title === "string" ? auth.title.trim().slice(0, MAX_TITLE) : "";
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const query = new URLSearchParams({ code, title: title || DEFAULT_TITLE });
        const response = await stub.fetch(`https://room/init?${query}`, { method: "POST" });
        if (response.ok) return json({ code, ...(await response.json<{ adminToken: string; screenKey: string }>()) }, 201);
      }
      return json({ error: "NO_CODE" }, 503);
    }

    const close = /^\/api\/rooms\/([A-Z2-9]{4})\/close$/.exec(url.pathname);
    if (close && request.method === "POST") {
      const auth = await authorize(request, env);
      if (auth instanceof Response) return auth;
      const response = await env.ROOMS.get(env.ROOMS.idFromName(close[1])).fetch("https://room/close", { method: "POST" });
      // 이미 없는 방이면 목록에 남은 줄만 지웁니다.
      if (!response.ok) await env.REGISTRY.get(env.REGISTRY.idFromName("main")).remove(close[1]);
      return json({ ok: true });
    }

    const ws = /^\/api\/rooms\/([A-Z2-9]{4})\/ws$/.exec(url.pathname);
    if (ws) {
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "EXPECTED_WEBSOCKET" }, 426);
      return env.ROOMS.get(env.ROOMS.idFromName(ws[1])).fetch("https://room/ws", request);
    }

    return json({ error: "NOT_FOUND" }, 404);
  },
};

export default worker;
