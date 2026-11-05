import { DurableObject } from "cloudflare:workers";
import type { RoomEntry } from "../src/game/protocol";

const PREFIX = "room:";

/** 대시보드용 방 목록. 계정 전체에 하나만 있고, 각 방이 상태가 바뀔 때 알려 줍니다. */
export class Registry extends DurableObject {
  async upsert(entry: RoomEntry): Promise<void> {
    await this.ctx.storage.put(PREFIX + entry.code, entry);
  }

  async remove(code: string): Promise<void> {
    await this.ctx.storage.delete(PREFIX + code);
  }

  async list(): Promise<RoomEntry[]> {
    const stored = await this.ctx.storage.list<RoomEntry>({ prefix: PREFIX });
    const now = Date.now();
    const alive = [...stored.values()].filter(entry => entry.expiresAt > now);
    const expired = [...stored.entries()].filter(([, entry]) => entry.expiresAt <= now).map(([key]) => key).slice(0, 128);
    if (expired.length) await this.ctx.storage.delete(expired);
    return alive.sort((a, b) => b.createdAt - a.createdAt);
  }
}
