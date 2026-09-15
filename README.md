# Work Aloud

Watch an AI write code, hear it explain, and interrupt with questions. The code appears as Cedar speaks; when you ask something, it freezes and later continues from exactly what you saw.

An experiment in working together through voice and visible changes. Coding is the first surface.

## Try it

You need **Node 22.9+**, the [Codex CLI](https://developers.openai.com/codex/cli) signed in with ChatGPT, and a direct [OpenAI API key](https://platform.openai.com/api-keys) for speech.

```sh
git clone https://github.com/itsHabib/work-aloud.git
cd work-aloud
cp .env.example .env
# Put your speech API key in .env as OPENAI_API_KEY=...
codex login
npm start
```

Open **http://127.0.0.1:4317**. No dependency install is needed to run the app.

1. Give it a small coding task and press **Build it & talk**. You can also paste existing code.
2. Focus the question box to pause, then press **Ask & listen**. Device dictation works in the box too.
3. Press **Continue coding**. Unseen drafts are discarded; it resumes from the visible file, even partway through a line.

Try: *“Build a small debounce function in JavaScript. Show how repeated calls reset the timer.”*

Code generation uses your Codex account. [Cedar speech](https://developers.openai.com/api/docs/guides/text-to-speech) uses `gpt-4o-mini-tts` and is billed separately to your API project. Your key stays on the local server. Environment variables take precedence over `.env`.

## How it works

Codex generates small code/explanation pairs. Each explanation becomes a Cedar audio clip, and the corresponding edit is typed according to that clip’s playback time. A question interrupts generation and includes the exact visible code as context. [Implementation and limits](docs/design.md).

This is a local prototype. Questions are typed or dictated; continuous microphone conversation is a possible next step. Generated code is displayed, never executed or tested by this app. Keep the server on loopback; it has no hosted account or billing system.

## Development

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Tests use explicit model and audio fixtures and make no inference calls. Runtime dependencies are Node and your installed Codex CLI; Playwright is only for development. The initial release was exercised with Codex CLI `0.153.4`. Its app-server interface is experimental, so later CLI changes may require an adapter update.

[MIT](LICENSE) · Built by Michael Habib
