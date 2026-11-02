/** The front page: what Icarus does, in the studio's paper and ink, and one way in. */
export function Home() {
  return (
    <div className="home">
      <header className="home-top">
        <a className="home-logo" href="/">
          icarus
        </a>
        <nav>
          <a href="#how">How it works</a>
        </nav>
        <a className="btn primary" href="/studio">
          Follow that dream
        </a>
      </header>

      <section className="home-hero">
        <div className="home-copy">
          <h1>Icarus</h1>
          <p className="home-lede">
            Design an office from a sentence or from your floor plans, walk through it in 3D, and
            change it by telling Icarus what to change.
          </p>
          <div className="row">
            <a className="btn primary big dream" href="/studio">
              Follow that dream →
            </a>
          </div>
          <ul className="home-checks">
            <li>Describe it, and get a furnished 3D office in about a minute</li>
            <li>Change it in plain words; Icarus checks every change</li>
            <li>Make it real: rendered on a cloud GPU, not on your laptop</li>
          </ul>
        </div>
        <figure className="home-art">
          <img
            src="/home/office-sketch.svg"
            alt="An office Icarus designed for a 35-person studio, being sketched in blue pen: the floor, the walls, then the desks and meeting rooms"
          />
          <span className="hand note-a">From a sentence to a 3D office.</span>
          <ul className="hand note-b">
            <li>Rooms</li>
            <li>Furniture</li>
            <li>Light</li>
          </ul>
          <span className="hand note-c">Edit · Walk · Render</span>
        </figure>
      </section>

      <section className="home-how" id="how">
        <article>
          <svg viewBox="0 0 64 48" aria-hidden="true">
            <path d="M6 8h40a6 6 0 0 1 6 6v14a6 6 0 0 1-6 6H24l-10 8v-8H6a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6z" />
            <path d="M12 18h28M12 25h18" />
          </svg>
          <h2>Describe it</h2>
          <p>
            Say who works there and what they need. Icarus plans the rooms, fits them in the space
            and furnishes them.
          </p>
        </article>
        <article>
          <svg viewBox="0 0 64 48" aria-hidden="true">
            <path d="M10 4h32l12 12v28H10z M42 4v12h12" />
            <path d="M18 22h28v16H18z M30 22v16 M18 30h12" />
          </svg>
          <h2>Bring your plans</h2>
          <p>
            Attach the PDF floor plans. Icarus traces the rooms, walls and doors, and joins the
            floors at the stair.
          </p>
        </article>
        <article>
          <svg viewBox="0 0 64 48" aria-hidden="true">
            <path d="M4 40 32 8l28 32z M20 40V28h24v12" />
            <circle cx="50" cy="12" r="5" />
          </svg>
          <h2>Walk and render</h2>
          <p>
            Walk through every room, then make any view real: path traced on a GPU in about ten
            seconds.
          </p>
        </article>
      </section>

      <footer className="home-foot">
        <p>Concept design only. Icarus does not check building codes, structure or construction.</p>
        <p>Muse Spark by Meta reads what you ask; Icarus's own checks decide what is built.</p>
      </footer>
    </div>
  );
}
