# ai-engineer-portfolio

A learning portfolio working through AI engineering fundamentals one week at a time. Each file is a small, runnable TypeScript script that builds on the last. Notes and lessons live in [NOTES.md](NOTES.md).

## Stack

- TypeScript (strict, ESNext modules) via [tsx](https://tsx.is/)
- [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript)
- [playwright](https://playwright.dev/) for the browser-agent exercises
- `dotenv` for loading `ANTHROPIC_API_KEY`

## Setup

```bash
npm install
npx playwright install chromium   # only needed for the playwright agent
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

## Running an example

```bash
npx tsx src/01-hello.ts
npx tsx src/02-tool-calling.ts
npx tsx src/03-structured-output.ts
npx tsx src/03b-structured-output-with-confidence.ts
npx tsx src/04-playwright-agent.ts
```

## Week 1 — SDK basics

| File | What it covers |
|------|---------------|
| [src/01-hello.ts](src/01-hello.ts) | Smallest possible `messages.create` call. |
| [src/02-tool-calling.ts](src/02-tool-calling.ts) | Multi-tool loop. Handles parallel `tool_use` blocks in a single turn. |
| [src/03-structured-output.ts](src/03-structured-output.ts) | Structured extraction via forced tool call (`tool_choice`). |
| [src/03b-structured-output-with-confidence.ts](src/03b-structured-output-with-confidence.ts) | Same pattern, extended with `extraction_confidence`, `missing_fields`, and `extraction_notes` for production-style routing. |
| [src/04-playwright-agent.ts](src/04-playwright-agent.ts) | Browser agent with `navigate` / `click` / `get_page_url` / `get_page_text` tools. Multi-turn loop until `stop_reason !== "tool_use"`. |

See [NOTES.md](NOTES.md) for experiments, observations, and TODOs.
