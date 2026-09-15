# The recorded demo

[Watch with sound](https://github.com/itsHabib/work-aloud/raw/refs/heads/main/docs/demo.webm).

This 58-second recording uses actual Codex generation and OpenAI Cedar speech. It begins when the first explanation starts, omitting the initial setup and generation wait. The rest runs at normal speed, including waits between explanations. Browser automation enters the task and question; neither the model responses nor the audio are fixtures.

The task is a small JavaScript `unique(items)` function. The recording pauses at the visible text `functi` and asks: “Does Set compare objects by value or by identity?” The answer leaves that text frozen. Continue sends the exact same `functi` back to the model, which completes:

```js
function unique(items) {
  const distinct = new Set(items);
  return [...distinct];
}
```

Recorded September 14, 2026 (Pacific time), using Codex CLI `0.153.4`, its configured `gpt-5.6-sol` model, and `gpt-4o-mini-tts` with Cedar. Five speech requests returned playable MP3s; the browser reported no page errors. The WebM contains the captured browser frames and the player’s actual audio. Audio decoding and a frame from the resulting file were checked after capture.

This verifies this interaction. It does not establish the correctness of arbitrary generated code, teaching effectiveness, or a latency guarantee. Live inference was exercised on macOS and Chromium; automated browser fixtures also run on Linux in CI.
