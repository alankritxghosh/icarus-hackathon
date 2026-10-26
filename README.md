# Icarus

Design a whole office from scratch, in words.

Tell Icarus about a company and show it a building shell. It plans the rooms and circulation, builds a complete walkable 3D office with furniture, lighting and materials, and then changes the design when you ask, by typing or speaking. It is built for the Meta Global AI Developer Hackathon (Indie developer track) on Muse Spark, SAM 3.1 and Muse Voice Transcribe.

Output is **concept design only**. It is not a building-code check, a structural design or a construction document, and Icarus says so wherever it matters. See [docs/DESIGN.md](docs/DESIGN.md) for exactly what it does and how.

## Provenance

This repository was created on **26 October 2026, after the hackathon kickoff (12:00 PM EDT)**, and every line of code in it was written during the hackathon. The Git history is unedited, so `git log` shows exactly what was built and when.

The idea is not new to this repository: the author explored a similar product in an earlier private prototype before the hackathon. That prototype is **not part of this repository**, no code or tests were copied from it, and nothing in it used a Meta model. What carried over is the problem framing, the lessons learned and the approved visual design (dark graphite and green, sidebar, one prompt, Home to Building to Built flow), not the code: every component here was written from scratch during the hackathon.

Code in this repository was written with the help of an AI coding assistant (Claude Code) under the author's direction.

## Status

Early build. See [docs/HACKATHON.md](docs/HACKATHON.md) for the plan and the daily log.
