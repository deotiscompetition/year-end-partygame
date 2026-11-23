import { AvatarArt } from "@/components/AvatarArt";
import type { PlazaPlayer, TeamView } from "@/game/protocol";

export function CharacterPlaza({ players, teams, scores, playing = false }: {
  players: PlazaPlayer[]; teams: TeamView[]; scores?: ReadonlyMap<string, string>; playing?: boolean;
}) {
  const colors = new Map(teams.map(team => [team.id, team.color]));
  return (
    <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-2xl border border-line bg-panel/65 p-3">
      <h2 className="shrink-0 text-xl font-black text-gold">{playing ? "실시간 개인 기록" : "참가자 광장"}</h2>
      {players.length === 0 && <p className="text-mist">참가자가 입장하면 여기에 나타나요.</p>}
      <ul className="grid content-start grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
        {players.map(player => {
          const color = colors.get(player.teamId) ?? "#ffd84d";
          return (
            <li key={player.id} className="flex min-w-0 flex-col items-center rounded-lg bg-night/65 px-1 py-1.5">
              {playing && <span className="min-h-6 w-full break-keep text-center text-sm font-black text-gold tabular-nums">{scores?.get(player.id) ?? "…"}</span>}
              <div className="flex h-12 w-full items-center justify-center">
                <AvatarArt avatar={player.avatar} color={color} className={playing
                  ? "size-11 motion-safe:animate-[character-step_900ms_ease-in-out_infinite]"
                  : "size-11"} />
              </div>
              <span title={player.nickname} className="w-full truncate text-center text-sm font-bold" style={{ color }}>{player.nickname}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
