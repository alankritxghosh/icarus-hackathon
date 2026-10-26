import { PlanThumb } from "./PlanThumb";
import { Prompt } from "./Prompt";
import { REFERENCES, type Reference } from "./references";
import { ago, type SavedBuild } from "./store";

export const DEMO_BRIEF =
  "A 35-person design studio. Open studio, three meeting rooms, two phone booths, a kitchen and lounge, reception, storage and server closet, restrooms. 24 m by 16 m shell, windows on south and east walls, entrance on the west.";

const STARTS = [
  { label: "35-person design studio", brief: DEMO_BRIEF },
  {
    label: "12-person startup",
    brief:
      "A 12-person startup. Open workspace, two meeting rooms, one phone booth, kitchen, reception, two restrooms. 14 m by 10 m shell, windows on the north and south walls, entrance on the west.",
  },
  {
    label: "Office with private rooms",
    brief:
      "A 20-person consultancy with six private offices, two meeting rooms, a kitchen, reception and storage. 22 m by 14 m shell, windows on the south wall, entrance on the north.",
  },
];

interface Props {
  builds: SavedBuild[];
  /** A problem from the last attempt, shown plainly. */
  notice?: string;
  onBuild: (brief: string) => void;
  onPhoto: (reference: Reference) => void;
  onOpen: (id: string) => void;
}

export function Home({ builds, notice, onBuild, onPhoto, onOpen }: Props) {
  return (
    <main className="home">
      <div className="glow" aria-hidden="true" />
      <h1>What will we design?</h1>
      <p className="sub">
        Describe the office you need. We plan the rooms, build it in 3D and show our working.
      </p>
      <Prompt
        placeholder="Describe the office: people, rooms, size, windows, entrance…"
        onBuild={onBuild}
      />
      <div className="starts">
        <span>TRY A STARTING POINT</span>
        {STARTS.map((s) => (
          <button key={s.label} type="button" onClick={() => onBuild(s.brief)}>
            {s.label}
          </button>
        ))}
      </div>
      {notice && (
        <p className="notice" role="alert">
          {notice}
        </p>
      )}
      <section className="photos">
        <p className="eyebrow">START FROM A PHOTO</p>
        <h2>Match a real space</h2>
        <p className="quiet">
          Pick a photograph of a real coworking space, or add your own. Icarus reads its style and
          contents and builds a similar office. It is a match in spirit: a photo gives no
          dimensions, so sizes are assumed and said so.
        </p>
        <div className="cards">
          {REFERENCES.map((r) => (
            <button key={r.id} type="button" className="card" onClick={() => onPhoto(r)}>
              <img src={r.src} alt={r.title} loading="lazy" />
              <span className="card-title">{r.title}</span>
              <span className="card-when">{r.credit}</span>
            </button>
          ))}
          <label className="card upload">
            <span className="card-title">Use your own photo</span>
            <span className="card-when">Stays in your browser except for the reading</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                onPhoto({
                  id: "upload",
                  src: URL.createObjectURL(file),
                  title: file.name.replace(/\.[^.]+$/, "").slice(0, 40) || "Your photo",
                  credit: "Your photo, used only here",
                });
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </section>
      <section className="library">
        <p className="eyebrow">YOUR DESIGNS</p>
        <h2>Your builds</h2>
        {builds.length === 0 ? (
          <p className="quiet">Designs you build appear here, saved on this device.</p>
        ) : (
          <div className="cards">
            {builds.slice(0, 8).map((b) => (
              <button key={b.id} type="button" className="card" onClick={() => onOpen(b.id)}>
                <PlanThumb plan={b.plan} />
                <span className="card-title">{b.title}</span>
                <span className="card-when">{ago(b.editedAt)}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
