# ClaudeControl

Chrome extension for an Ollama-powered browser agent that runs in Chrome's right side panel, keeps the page visible on the left, and can inspect pages, type, click, navigate, search, and execute multi-step web tasks.

This repo now also includes a desktop browser shell under `desktop/` so the project can move past Chrome extension limits and toward a more Comet-like, AI-native browsing experience powered by local Ollama models.

## End Goal

Build the closest practical thing to an AI-native browser assistant inside Chrome:

- always available from the right side panel
- aware of the active tab, visible page state, and open tabs
- able to inspect, navigate, type, click, scroll, select, hover, and move a visible cursor
- transparent about what it is doing through logs, decision traces, and approval gates
- powered by local or self-hosted Ollama-compatible models instead of a hosted closed model

This project is not aiming for literal 100% control of Chrome. Chrome extensions cannot directly control `chrome://` pages, native permission prompts, extension pages, or operating-system UI. The goal is maximum useful control inside the boundaries Chrome allows.

## Current State

Working now:

- Chrome side panel agent UI
- desktop browser shell with a real browsing surface on the left and agent rail on the right
- Ollama endpoint configuration and installed-model selection
- tab-aware browser tools
- DOM inspection and action execution
- activity log and safe reasoning summaries
- end-to-end browser-control verification
- visible on-page cursor movement for agent actions

Still incomplete:

- screenshot-grounded vision loop
- long-horizon planning across many tabs
- robust workflow memory and saved procedures
- stronger recovery logic for dynamic sites
- polished AI-native browser UX comparable to a full custom browser

## Comet Comparison

This extension is being shaped toward the feel of products like Perplexity Comet, but it is still a Chrome extension, not a browser fork.

Where we want to feel similar:

- assistant-first browsing instead of a separate chatbot tab
- persistent right-rail workflow
- natural-language tasks that turn into browser actions
- clear awareness of the current page and browsing context
- faster “search, inspect, act” loops

Where a Chrome extension is naturally weaker than a custom browser:

- less access to browser internals
- weaker control over native browser UI
- more friction around permissions and restricted pages
- fewer deep hooks for cross-tab memory and navigation primitives

So the target is not “be Comet in name.” The target is “deliver the most Comet-like workflow we can inside stock Chrome.”

## Product Plan

### Phase 1: Reliable Browser Control

Goal: make every basic browser action dependable and visible.

- keep the control loop stable with Ollama-compatible models
- expand deterministic page tooling
- maintain the visible cursor and target highlighting
- improve error reporting when a page is restricted or a model call fails
- keep end-to-end verification passing on every major change

Success criteria:

- simple tasks like search, open site, type, click, and submit work consistently
- users can see where the agent is about to act
- failures are diagnosable from the side panel alone

### Phase 2: Comet-Style UX

Goal: make the extension feel less like a developer tool and more like an AI-native browser assistant.

- simplify the side panel hierarchy
- improve typography, spacing, and action affordances
- keep current page context obvious at all times
- show intent, next action, and approvals more clearly
- make logs expandable instead of noisy

Success criteria:

- tasks feel understandable while they run
- activity feed is readable without squinting
- common flows need fewer manual refreshes or context switches

### Phase 3: Better Grounding

Goal: make the agent smarter on modern websites.

- add screenshot capture into the action loop
- combine DOM inspection with visual grounding
- detect ambiguous targets and ask for confirmation when needed
- improve dynamic-site handling for SPAs and delayed rendering

Success criteria:

- the agent can recover on pages where DOM labels alone are weak
- targeting accuracy improves on visually complex layouts

### Phase 4: Durable Workflows

Goal: support repeatable real-world tasks.

- saved workflows and reusable task templates
- structured session memory
- better multi-tab coordination
- resumable execution after navigation

Success criteria:

- users can re-run frequent tasks without rewriting prompts
- long tasks survive tab changes and normal browsing interruptions

## Technical Direction

Core pieces in this repo:

- `src/background/`
  background orchestration, Ollama client, browser tools, task runner
- `src/content/`
  page inspection, DOM actions, visible cursor, target highlighting
- `src/sidepanel/`
  agent UI, activity feed, reasoning summaries
- `src/options/`
  endpoint/model configuration
- `scripts/verify-browser-control.mjs`
  end-to-end control verification in real Chrome

Design principles:

- show actions, do not hide them
- default to reversible operations when possible
- prefer deterministic tools over free-form guessing
- keep the model replaceable
- verify real browser behavior, not just internal state

## Recommended Near-Term Work

Highest-value next steps:

1. Add screenshot-grounded action selection.
2. Make the side panel more like a task cockpit than a log viewer.
3. Add richer cursor interactions such as drag, explicit mouse move, and element focus previews.
4. Improve approval flows for sensitive forms and submission buttons.
5. Test against a wider set of real websites with saved fixtures.

## Run The Desktop Browser

Install dependencies:

```bash
npm install
```

Start the desktop browser shell:

```bash
npm run desktop
```

Smoke-test that the browser shell boots:

```bash
npm run desktop:smoke
```

## Verification

The repo includes an end-to-end verifier that launches Chrome, loads the extension, issues a natural-language browser task, and confirms the page changed because of the extension’s actions.

Run:

```bash
npm run verify:e2e
```

For local Ollama use, make sure Ollama is running with extension-safe CORS:

```bash
OLLAMA_ORIGINS="*" ollama serve
```

Then configure the extension with:

- Base URL: `http://127.0.0.1:11434`
- API key: blank
- Model: one of your installed Ollama models such as `qwen3:latest`

## Reality Check

This project can get very close to the experience of an AI-native browser assistant, but the hard parts are not just UI polish. The real quality bar is:

- reliable tool selection
- visible and trustworthy actions
- recovery from messy real websites
- enough grounding that users trust it on live tasks

That is the work ahead, and that is what this repo is now organized around.
