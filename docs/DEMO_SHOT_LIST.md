# Demo video: 90-second shot list

Record on the live site, https://icarus.dream-studio.workers.dev, in a desktop browser at 1440 px wide. Test on mobile
data first if the Wi-Fi's DNS still caches the old subdomain. Type the sentences exactly; they are the ones measured.

| Time | Shot | Do | Say (voice-over) |
|---|---|---|---|
| 0:00–0:08 | Homepage | Show the hero, click **Follow that dream**. | "Icarus designs an office from a sentence." |
| 0:08–0:25 | Studio, brief | Click the **35-person design studio** starter. Let the "Building your space" steps run. | "Muse Spark proposes what the brief left out. A layout engine places every room and checks the plan; the model never draws geometry." |
| 0:25–0:35 | 3D overview | Orbit the model once. Open **Floor Plan** for two seconds, back to **3D**. | "Rooms, corridors, furniture and light, in about thirty seconds." |
| 0:35–0:50 | Edit by words | Type: `the lounge feels cramped, give it noticeably more space` and send. Then type `a couple more phone booths would be great` and send. | "Change it in plain words. Muse Spark reads the sentence into edits, and the validators decide what is kept." |
| 0:50–0:56 | A refusal | Type: `add a swimming pool next to reception` and send. Show the reply. | "What it can't do, it says, instead of guessing." |
| 0:56–1:12 | Walk | Open **Walkthrough**. Click **Kitchen** in the views strip, then **Meeting room 1**. Walk a few steps with W. | "Walk through it, room by room." |
| 1:12–1:25 | Make it real | Click **✦ Make it real**, cut the wait (about 4 minutes), then walk from the open workspace into the lounge with W. | "Make it real path-traces the light of the whole building on a cloud GPU, and you walk through it." |
| 1:25–1:30 | End card | Hold on the render. | "Icarus. Concept design only." |

## Before recording

- Make it real takes about 4 minutes; record the bake once beforehand so the cut is clean.
- All three sentences are from the 20 measured in `apps/web/test/eval/editModel.eval.test.ts` (run5: each read right
  or flagged). Run them once on the live site before recording; cut any shot that does not behave.
