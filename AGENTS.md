# Work Aloud

A small local coding demonstration: generated edits appear while Cedar explains them. Keep changes focused on that experience.

- Read README.md and docs/design.md for setup and boundaries.
- Run `npm test` and `npm run test:browser` for behavior changes. Tests must not call paid APIs; use explicit fixtures.
- Preserve exact visible-code context when pausing, answering, and continuing.
- Keep credentials on the server, serve only public/, and retain loopback and Origin checks.
- Do not add code execution or enable model tools as incidental cleanup.
- Prefer direct implementations, early returns, small functions, and no new runtime dependencies without a concrete need.
- Keep environment files, personal paths, local recordings, and provider diagnostics out of commits. Demo media belongs in docs/ only after inspection.

Current map: server.mjs serves the app; narrator.mjs adapts Codex; narrator-api.mjs owns session endpoints; speech.mjs generates audio; public/ owns playback and typing.
