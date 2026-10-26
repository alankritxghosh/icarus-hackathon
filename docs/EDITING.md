# Changing an office with words

Type what you want changed ("move the kitchen east", "add a third phone booth", "swap reception and the lounge", "lock the kitchen") and the plan changes. This works the same way as the repair loop: the words can only become a small closed set of operations, and every operation is measured before it is kept.

## What it can do

| Operation | Words that work | What it does |
|---|---|---|
| `move_room` | "move the kitchen east", "put the lounge on the north side" | Puts a room in the north, south, east or west part of the shell (its centre in that outer 40%). |
| `swap_rooms` | "swap the lounge and the kitchen" | Each room takes the other's row, or, within one row, their order flips. |
| `add_phone_booths` / `remove_phone_booths` | "add a third phone booth", "add two more", "remove a phone booth" | Changes the count; "third" means a total of three, from the count that is there. |
| `lock_room` / `unlock_room` | "lock the kitchen", "unlock everything" | A locked room is kept where it is by later edits. |
| undo | "undo", or the Undo button | Returns to the design before the last change. |

Several can be said at once ("move the kitchen east, add a third phone booth and lock the lounge"). Compass directions are real directions on the plan whatever side the entrance is on. Room names work by kind, number or ordinal ("meeting room 2", "the third meeting room"), by a name you gave the room, or by id; a phrase that fits several rooms ("the meeting room" when there are three) is refused with the choices, never guessed.

It cannot add or remove rooms, resize the shell, change the headcount or change colours. A request outside this set is answered with what it cannot do; nothing is changed.

## How a request is read

1. A small fixed grammar (`packages/core/src/edit/words.ts`) reads the common requests with no model. A phrase that does not name a room in the plan is not guessed at.
2. Anything the grammar cannot read goes to the model through `POST /api/design/edit`. The model answers in the same closed operations (validated against `EditSchema` in the Worker and again in the browser), or says in one sentence what it cannot do. It is never asked for coordinates.
3. Either way the operations are applied by `applyEdit` (`packages/core/src/edit/apply.ts`), which is deterministic and needs no model.

## How an edit is measured

An edit works on the arrangement of rooms (the order in each row), not on a fresh search. The program holds that order (`program.arrangement`), so the plan is reproduced exactly when reopened, and an edit changes what was asked and little else. For a move or a swap:

1. Candidate arrangements are generated: the room inserted at every position in every row, or swapped with every other room (for a swap, one candidate, plus one that keeps reception first in its row).
2. Each is planned. A candidate must do what was asked and keep every locked room within tolerance (the larger of 2 m and 12% of the longest wall).
3. The best few by the solver's own cost are fully measured (furnished and diagnosed), and the one with the lowest score that introduces no new failure, and does not take reception off the entrance lobby, is kept.
4. If none passes, the plan is left alone and the reason is said: which locked room would move, or which check would break.

Adding a phone booth is measured the same way: it must fit along the open workspace walls and must not push the plan into a new failure (for example, leaving 7 of 8 workstations).

Every result line shows what was measured: how far the room moved, which other rooms shifted, any new notes, and the score before and after. When an edit the user asked for makes the measured score clearly worse, it still applies (it is their request) and says so, with Undo to hand.

## Undo, locks, history

- Each applied request is one step in the session's history, so one Undo reverses a whole sentence. Locks are part of the design, so undo restores them too.
- Locks hold within tolerance, not exactly: rooms shift when a neighbour is removed from a row. A lock that cannot be honoured blocks the edit and names the rooms it would move.
- "Another layout" starts a new search, so it clears moves and locks made in words; Undo brings them back.
- The form editor (Edit) builds a new program, so it also clears them.

## Measured (12 briefs, rules only, no model)

`docs/reference/edit-eval/run1-twelve-briefs.json`. For each brief, on the repaired design: move the kitchen and the lounge to each of the four sides, add a third phone booth, and swap reception with the lounge and with the kitchen. 103 requests in all.

- 45 applied, 36 left unchanged because the room was already in that part of the office, 22 refused with a stated reason.
- **No applied edit introduced a failure the plan did not already have** (the first run found one: a booth that left 7 of 8 workstations; the booth path now uses the same rule).
- Moves: 34 applied, 36 already there, 6 refused. Booths: 7 applied, 1 refused. Swaps with reception: 4 applied, 15 refused because reception must stay on the entrance lobby, and in most plans the lounge or kitchen shares reception's row, where swapping would push reception off it. This is a real limit of the row layout, not a bug, and the refusal says so.
- The median change in score among applied edits was +7.7 (worse); 14 of 45 were equal or better. That is expected: the solver had already optimised the plan, so moving a room somewhere it did not choose costs something. The edit picks the best way to do what was asked, and says when it measured worse.
- An edit takes a few milliseconds in the browser (median under 1 ms, 95th percentile 6 ms on this machine).

## Limits

- The edit set is small on purpose. "Make the kitchen bigger", "add a meeting room" and colour changes are not here yet.
- "Within the east part" is a rule of thumb (outer 40%), not a precise position, and no exact coordinates can be asked for.
- Swaps are row-level: they exchange rooms' places in the row structure, so the rooms keep their own sizes and the neighbours shift to fit.
- The model path is only exercised through a scripted fake in tests; it has not been run live against a free model yet.
- Room labels were added to the floor plan so a request can be checked by eye; they are only shown in the plan view.
