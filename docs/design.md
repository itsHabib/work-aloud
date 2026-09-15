# Implementation

The browser owns the visible file. `narrator.mjs` starts an ephemeral Codex app-server conversation and parses newline-delimited records containing a short explanation and a complete file snapshot. `narrator-api.mjs` streams these pairs to the browser and manages cancellation and session lifetime. `speech.mjs` sends only the explanation text to OpenAI’s fixed speech endpoint.

`public/narrator-client.mjs` plays each clip and applies its edit using `public/typing.mjs`. The player preserves the unchanged prefix and suffix while typing the replacement. A question sends the exact frozen code back to the model; answering cannot change it. Continuing discards unheard drafts and starts from that frozen code.

## Timing

Each short explanation and its complete MP3 must arrive before playback starts. Later code can generate during playback, but speech clips are requested one at a time. Typing follows playback time, with a short tail after the edit finishes. This is paced commentary, not alignment between individual model tokens and spoken words. Explanations describe the work; they are not private internal reasoning.

## Scope

Start with a small function or class. Prompts target files under 90 lines; the parser enforces at most 24 edits and 24 KB per file snapshot. A model can still produce incorrect code. There is no execution, filesystem editing, learner assessment, or durable project state. End preserves the visible code; reload closes the session. Use Copy code to keep the result.

The next useful experiment is a second visible surface, such as drawing a diagram. A shared abstraction should follow that experiment.

## Local boundaries

The server binds to `127.0.0.1`, serves only `public/`, and checks Origin and JSON content type before API mutations. `.env` is ignored by Git and is outside the served directory. Keys come only from the explicit environment or the project’s `.env`; the app does not search other projects or parent directories for credentials.

The Codex child runs in an empty temporary directory with API-key environment variables removed. It uses the existing ChatGPT login. Shell, plugins, apps, additional agents, memory features, configured MCP servers, and host skill discovery are disabled. No execution environments or dynamic tools are selected, and this client rejects tool and approval requests. These are application settings, not operating-system isolation for the whole Codex installation.

There are at most two sessions; idle sessions expire after ten minutes. Model turns have a two-minute interruption timer. Speech has a thirty-second timeout and follows browser cancellation. Credential and speech transport errors use fixed messages that do not forward sensitive provider diagnostics.

Do not expose this server to the internet. A hosted edition would need its own authentication, usage controls, and account handling.
