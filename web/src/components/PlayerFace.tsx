import { useState } from "react";
import { defenseTeam } from "../lib/gauntletEngine.mjs";

// Player headshots and NFL team logos from ESPN's image CDN. Fantasy player
// ids are ESPN athlete ids; team defenses use their team's logo. Any image
// that fails to load falls back to initials, so a missing photo never shows
// a broken image.

const CDN = "https://a.espncdn.com/combiner/i?img=";
export const headshotUrl = (id: number) => `${CDN}/i/headshots/nfl/players/full/${id}.png&w=96&h=70&scale=crop&cquality=60`;
export const logoUrl = (abbr: string) => `${CDN}/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png&w=64&h=64`;

function initials(name: string) {
  return name.replace(/ D\/ST$/, "").split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

export function TeamLogo({ team, size = 16 }: { team: string | null | undefined; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!team || failed) return null;
  return (
    <img className="team-logo" src={logoUrl(team)} alt={team} title={team} width={size} height={size}
      loading="lazy" decoding="async" onError={() => setFailed(true)} />
  );
}

export function PlayerFace({ player, size = 36, showTeam = true }: {
  player: { player_id: number; name: string; position: string; team?: string | null };
  size?: number;
  showTeam?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const defense = defenseTeam(player.player_id);
  const style = { width: size, height: size };
  if (defense) {
    return (
      <span className={`face face-def${failed ? " is-fallback" : ""}`} style={style} aria-hidden="true">
        {failed ? <span className="face-initials">{defense}</span> : (
          <img src={logoUrl(defense)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
        )}
      </span>
    );
  }
  return (
    <span className={`face pos-${player.position.replace("/", "")}`} style={style} aria-hidden="true">
      {failed ? <span className="face-initials">{initials(player.name)}</span> : (
        <img src={headshotUrl(player.player_id)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      )}
      {showTeam && player.team ? <span className="face-team"><TeamLogo team={player.team} size={Math.round(size * 0.42)} /></span> : null}
    </span>
  );
}

export const faceCss = `
  .face { position: relative; display: inline-grid; place-items: center; flex: none; border-radius: 50%; background: #d9d0bd; overflow: visible; }
  .face > img { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; object-position: 50% 15%; background: #e7dfcf; }
  .face-def { background: #fff; box-shadow: inset 0 0 0 1px #0001; }
  .face-def > img { object-fit: contain; padding: 3px; background: #fff; }
  .face-def.is-fallback { background: #202c30; }
  .face-def.is-fallback .face-initials { font-size: 0.56rem; }
  .face-initials { font: 700 0.62rem var(--font-body); color: #fff; letter-spacing: 0.03em; }
  .face.pos-QB { background: #603d46; } .face.pos-RB { background: #324c42; } .face.pos-WR { background: #193b48; }
  .face.pos-TE { background: #624830; } .face.pos-K { background: #6a6a5a; }
  .face-team { position: absolute; right: -4px; bottom: -3px; display: grid; place-items: center; background: #fff; border-radius: 50%; padding: 1px; box-shadow: 0 0 0 1px #0002; }
  .face-team .team-logo { display: block; }
  .team-logo { object-fit: contain; vertical-align: middle; }
`;
