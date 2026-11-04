# Demo video: 3-minute shot list

Record on the live site, https://icarus.dream-studio.workers.dev, in a desktop browser at 1440 px wide or more. Test on mobile data first if the Wi-Fi's DNS
still caches the old subdomain.

Type the sentences exactly. Each one behaved as described on the live site on 4 Nov 2026 (QA report). The layout depends
on Muse Spark's proposal and can differ between runs, so **rehearse once and cut any shot that misbehaves**. Do not
resize a meeting room in the demo: on the live build that silently renames another meeting room (P1-1).

The voice-over may say "Icarus". On-screen text uses the lowercase `icarus` wordmark.

| Time | Shot | Do | Say (voice-over) |
|---|---|---|---|
| 0:00–0:20 | Homepage | Show the hero, then click **Follow that dream**. | "Planning an office today means a broker's floor plan, a designer's first sketch or a spreadsheet of seats. Icarus designs the office from a sentence." |
| 0:20–0:50 | Studio, brief | Click the **35-person design studio** starter. Let the "Building your space" steps run (about 45 s; cut the middle), and hold on "Weighed the model's proposal". | "Muse Spark reads the brief and proposes what an office like this needs. A deterministic layout engine places every room, furnishes it and checks the plan, and keeps only the ideas that fit. The model never draws geometry." |
| 0:50–1:00 | 3D overview | Orbit once. Open **Floor Plan** for two seconds, then back to **3D**. | "Rooms, corridors, furniture and light, in under a minute." |
| 1:00–1:12 | Edit by words | Type `a couple more phone booths would be great` and send (about 13 s; cut the wait). Show "Added 2 phone booths". | "Change it in plain words. Muse Spark reads the sentence into edits; the engine decides what is kept." |
| 1:12–1:27 | Collateral named | Type `we need one more meeting room for client calls` and send (about 12 s). Hold on the reply: it names the open workspace moving, and says when the plan measures worse. | "When one change moves something else, it says so, and it tells you when a change makes the plan worse." |
| 1:27–1:35 | A refusal | Type `add a swimming pool next to reception` and send (about 4 s). Show "I could not do that." | "What it can't do, it says, instead of guessing." |
| 1:35–1:40 | Undo | Type `undo` and send. | "And anything can be undone." |
| 1:40–2:05 | Walk | Open **Walkthrough**. Click **Kitchen** in the views strip, then **Meeting room 1**. Walk a few steps with W. | "Walk through it, room by room." |
| 2:05–2:35 | Make it real | Click **✦ Make it real**. Cut the wait (about 4–5 minutes; use the bake recorded beforehand), then walk from the open workspace into the lounge with W. | "Make it real path-traces the light of the whole building with Blender on a cloud GPU, and you walk through it." |
| 2:35–2:50 | Exports, how it works | Open **Export ↗** and show both choices. | "Take it into Blender, or into CAD as a floor plan. The model proposes; the engine decides." |
| 2:50–3:00 | End card | Hold an end card: `icarus`, "Concept design only". | "Icarus. Concept design only: not a building-code check, a structural design or a construction document." |

## Before recording

- Make it real took 296 s in the QA run and 240–245 s earlier. Record the bake once beforehand so the cut is clean.
- The phone-booth, meeting-room, swimming-pool and undo sentences were run live on 4 Nov (QA report). The phone-booth and
  swimming-pool sentences are also among the 20 measured in `apps/web/test/eval/editModel.eval.test.ts`.
- The old opening edit, `the lounge feels cramped, give it noticeably more space`, was refused on 4 Nov because the
  lounge was already twice its target. It is left out.
- "Weighed the model's proposal" may read "0 of 3 ideas kept". The voice-over above stays true either way. Do not say
  that Muse Spark added rooms unless the screen shows ideas kept.
