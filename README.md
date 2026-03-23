# ElectronBrowser

Local-first browser shell with an Ollama-powered assistant built into the right rail.

The main product in this repo is the desktop Electron browser under `desktop/`. It gives you:

- a normal browser-style shell with tabs, navigation, address bar, and browsing surface
- a built-in assistant chat panel on the right
- direct local Ollama integration through the Electron main process
- browser actions such as inspect, click, type, hover, scroll, navigate, and tab control
- conversational help like:
  - "summarize this page"
  - "explain what you see"
  - "click the Sign in button"
  - "open github.com and tell me the main call to action"

The older Chrome extension prototype is still in this repo under `src/`, but the desktop browser is the primary direction now.

## Current Status

Working now:

- desktop browser shell with tabs and navigation
- assistant chat UI in the right rail
- local Ollama model selection and connection testing
- page inspection and browser control tools
- visible cursor for page actions
- assistant rail scrollbar plus up/down scroll buttons
- smoke-tested desktop startup flow

Still in progress:

- screenshot-grounded vision
- richer memory across long browsing sessions
- more robust recovery on messy dynamic sites
- deeper browser features like downloads/history polish

## How To Set Up

### 1. Clone the repo

```bash
git clone https://github.com/VSTM26/ElectronBrowser
cd ElectronBrowser
```

### 2. Install dependencies

```bash
npm install
```

This downloads Electron and the local dev dependencies.

### 3. Start Ollama

Make sure Ollama is installed and running locally.

Example:

```bash
ollama serve
```

In another terminal, make sure you have at least one model downloaded:

```bash
ollama pull qwen3:latest
```

The desktop browser defaults to:

- Base URL: `http://127.0.0.1:11434`
- Model: `qwen3:latest`

### 4. Launch the desktop browser

```bash
npm run desktop
```

If you are working from a cloud-synced folder and want to stage the app into a local cache first, you can also use:

```bash
./launch-electron-local.command
```

## First Run

Once the browser opens:

1. Open the right assistant rail if it is collapsed.
2. Scroll to the `Ollama / Connection` card.
3. Confirm the base URL and model.
4. Click `Test`.
5. Start chatting in the assistant panel.

Good first prompts:

- `Summarize this page`
- `Explain what you see on this page`
- `Inspect the page and tell me the primary call to action`
- `Click the first sign in button`
- `Open github.com in this tab`

## Development Commands

Launch the desktop browser:

```bash
npm run desktop
```

Run the desktop smoke test:

```bash
npm run desktop:smoke
```

Run the Chrome-extension end-to-end verifier:

```bash
npm run verify:e2e
```

Note:
- `desktop:smoke` tests the Electron browser shell.
- `verify:e2e` is for the older Chrome extension flow, not the desktop shell.

## Repo Layout

- `desktop/`
  Electron main process, preload bridge, browser shell UI, and page agent logic
- `src/`
  legacy Chrome extension prototype
- `scripts/verify-browser-control.mjs`
  end-to-end Chrome extension verification script
- `setup.sh`
  helper script for Ollama setup and extension-safe CORS

## Ollama Notes

For the desktop browser, Ollama requests go through Electron's main process, so browser CORS is not the main issue.

For the Chrome extension and the extension verifier, you may still need Ollama CORS enabled. This helper sets that up:

```bash
./setup.sh
```

You can also run Ollama manually with:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

## What The Assistant Can Do

The assistant can mix normal chat with browser actions in the same thread.

Examples:

- answer questions about the active page
- summarize visible content
- inspect interactive elements before acting
- click buttons and links
- type into forms
- open tabs and navigate between pages
- search Google when given a plain-language query

The goal is not a separate chatbot tab. The goal is an assistant that can both talk about the page and operate it.

## Near-Term Direction

The next major improvements are:

1. Better grounding with screenshots plus DOM context.
2. Stronger real-world task reliability on dynamic websites.
3. More browser-native polish in the desktop shell.
4. Better conversation memory and reusable workflows.

## Reality Check

This is already beyond a simple extension demo, but it is not yet a finished AI-native browser. The hard part is reliability on real sites, not just UI.

The main bar for this repo is:

- useful local browsing assistance
- visible, trustworthy actions
- clean browser ergonomics
- free local Ollama-powered workflows
