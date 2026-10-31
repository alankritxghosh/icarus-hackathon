# Icarus submission draft

31 October 2026. Local review draft. No repository publication, deployment or submission is authorized by this file.

The [Meta event page](https://dev.meta.ai/events/global-hackathon) lists the Indie developer track, the “Push the Frontier” theme and a 4 November 2026, 9 PM ET deadline. It says Indie entries are judged on creativity, technical ambition and whether the project works. Check the participant portal and official rules before finalizing fields or eligibility.

## Proposed short description

Icarus turns a written office brief into a measured floor plan and a walkable 3D concept. A person can ask for a change in the same conversation, see which other rooms moved, undo, and hand off a DXF plan or GLB scene. It reports when the requested office does not fit.

## What the demo proves

The 12-person starter asks for two meeting rooms, one phone booth, a kitchen, reception and two restrooms in a 14 × 10 m shell. Icarus places 5 of 12 workstations there and says so. It offers a checked 16.5 × 11.5 m shell; after the user accepts, the concept has 12 of 12 workstations and one booth. A kitchen move says that Meeting room 1 also moved 3 m. The recording shows Plan and Walk, both exports, undo and reopening the saved project.

The uncut 75.68-second browser recording, exact brief and replies, SHA-256 hashes and exports are local under ignored `fixtures/private/qa-demo/`. The GLB passed the Khronos glTF Validator with zero errors and 73 tangent warnings. The DXF passed `ezdxf audit` with zero errors and 67 entities. Browser tests at 1440, 390 and 320 px, the 158-request edit audit and `pnpm verify` passed. See [OPEN_GATES.md](OPEN_GATES.md) for the evidence and limits.

## Model use and limits to state accurately

The repository supports Meta Llama models through Cloudflare Workers AI; its local offline rules path works without a key. The captured demo used that local path. The direct Meta Model API route has not been live-smoke-tested in this worktree because no key is configured. Muse Spark, voice transcription and SAM-based plan reading are not demonstrated. Do not describe this as general “prompt anything” 3D creation, code-compliant architecture or construction design.

The drawing importer is also incomplete: a real residential A3 sheet enclosed 5 of 23 labelled rooms. A second A3 sheet required a printed scale. The drawing edit shown in tests covers straight, identifiable partitions in simple vector evidence, not arbitrary plans. No workplace designer has independently approved a result. Projects stay in one browser.

## Release decisions still required

- Verify the participant portal's submission fields, official rules and any demo or repository requirements.
- Confirm which live Meta-model path can be shown with an authorized key and spending limit, and update the model-use sentence with the measured result.
- Get an independent workplace-design review and representative office-plan benchmark, or keep both limitations explicit in the submission.
- Review final copy, licences, tracked files and demo media for publication. The recorded GLB and DXF are local evidence, not public assets yet.
- Obtain the founder's explicit approval before pushing, making the repository public, deploying, using paid resources or submitting.
