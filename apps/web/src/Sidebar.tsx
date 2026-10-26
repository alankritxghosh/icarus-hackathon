import { ago, type SavedBuild } from "./store";

interface Props {
  builds: SavedBuild[];
  onHome: () => void;
  onOpen: (id: string) => void;
  active?: string;
}

export function Sidebar({ builds, onHome, onOpen, active }: Props) {
  return (
    <nav className="sidebar" aria-label="Workspace">
      <div className="brand">
        <span className="mark" aria-hidden="true" />
        <div>
          <b>ICARUS</b>
          <small>DESIGN AN OFFICE</small>
        </div>
      </div>
      <button type="button" className="new-build" onClick={onHome}>
        + New build
      </button>
      <div className="nav">
        <button type="button" className={active ? "" : "on"} onClick={onHome}>
          Home
        </button>
      </div>
      <h3>Recents</h3>
      <ul className="recents">
        {builds.slice(0, 6).map((b) => (
          <li key={b.id}>
            <button
              type="button"
              className={active === b.id ? "on" : ""}
              onClick={() => onOpen(b.id)}
              title={ago(b.editedAt)}
            >
              {b.title}
            </button>
          </li>
        ))}
        {builds.length === 0 && <li className="quiet">Nothing yet.</li>}
      </ul>
      <p className="account">
        Saved on this device only. Concept design, not a building-code check.
      </p>
    </nav>
  );
}
