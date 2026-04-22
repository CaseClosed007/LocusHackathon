# Locus Phoenix 🔥

**Autonomous self-healing deployment agent** — describe your app in plain English, and Locus Phoenix writes the code, deploys it to [Locus Build](https://buildwithlocus.com), and automatically diagnoses and patches every failure until it's live.

Built for the **Locus Paygentics Hackathon #2**.

---

## What it does

1. **Natural language → code** — type "Deploy a Python Flask API that returns Hello World" and Gemini generates all the source files
2. **One-click deploy** — pushes generated code to Locus Build via git, triggers a real containerized deployment
3. **Self-healing loop** — if the build fails, the agent fetches the logs, asks Gemini to diagnose and patch the code, and redeploys automatically (up to 3 attempts)
4. **GitHub deploy** — paste any GitHub repo URL and it fetches, analyses, and deploys it
5. **Brand RAG** — upload a PDF brand guide or logo image; the agent extracts colors, fonts, tone, and design rules and injects them into every generated file
6. **Iterative editing** — after a successful deployment, chat with the agent to apply changes ("make the hero dark mode") — it patches the code, shows a diff, and redeploys without starting over
7. **Payment-aware** — checks your Locus wallet balance before each heal attempt, tracks AI call costs, and shows ROI on success

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, React 19, Tailwind CSS, Framer Motion |
| Backend | Python FastAPI, Server-Sent Events (SSE) |
| AI | Google Gemini 2.5 Pro / 2.0 Flash via Locus payment rails |
| PaaS | Locus Build (`beta-api.buildwithlocus.com`) |
| Payments | Locus wallet (`beta-api.paywithlocus.com`) |

---

## Project structure

```
LocusHackathon/
├── backend/
│   ├── agent/
│   │   ├── heal_agent.py        # Core autonomous agent + iterative editing
│   │   ├── locus_client.py      # Locus Build API client (deploy, redeploy, poll)
│   │   ├── github_client.py     # GitHub repo fetcher + analysis
│   │   ├── brand_extractor.py   # PDF/image → BrandContext via Gemini Vision
│   │   └── prompts.py           # Gemini prompt templates
│   ├── models/
│   │   └── schemas.py           # Pydantic models (AgentThought, BrandContext, …)
│   ├── main.py                  # FastAPI app + SSE endpoints
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/                     # Next.js app router
    ├── components/
    │   ├── ChatTerminal.tsx     # Main terminal UI + conversation history
    │   ├── IteratePanel.tsx     # Iterative edit chat panel (post-deploy)
    │   ├── BrandUploader.tsx    # Drag-and-drop brand PDF/logo uploader
    │   ├── ThoughtLine.tsx      # Agent thought renderer
    │   ├── CodeViewer.tsx       # Generated file accordion
    │   ├── DiffViewer.tsx       # Before/after unified diff viewer
    │   ├── GitHubPreview.tsx    # Repo preview card for GitHub URLs
    │   ├── CreditsModal.tsx     # Locus wallet top-up UI
    │   └── StatusBadge.tsx      # Thought type badges
    └── lib/
        ├── types.ts
        ├── useDeployStream.ts   # SSE hook for /deploy
        └── useIterateStream.ts  # SSE hook for /iterate
```

---

## Getting started

### Prerequisites

- Python 3.11+
- Node.js 20+
- A [Locus account](https://app.paywithlocus.com) with a `claw_` API key
- A [Gemini API key](https://aistudio.google.com/app/apikey)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env
# Edit .env — add your GEMINI_API_KEY and LOCUS_API_KEY

python main.py
# API runs at http://localhost:8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
# UI runs at http://localhost:3000
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `GEMINI_MODEL` | No | Pro model name (default: `gemini-2.5-pro-exp-03-25`) |
| `GEMINI_FAST_MODEL` | No | Fast model name (default: `gemini-2.0-flash`) |
| `LOCUS_API_KEY` | Yes | Locus `claw_` API key |
| `LOCUS_API_BASE_URL` | No | Payment API base URL (default: beta endpoint) |
| `LOCUS_BUILD_API` | No | Build API base URL (default: beta endpoint) |
| `LOCUS_GIT_HOST` | No | Git push host (default: beta endpoint) |
| `USE_LOCUS_WRAPPED` | No | Route LLM calls through Locus payment rails (default: `true`) |
| `GITHUB_TOKEN` | No | GitHub PAT for higher rate limits on private/heavy repos |

---

## How the agent works

### Deploy flow

```
User prompt
    │
    ▼
parse_request()       NL → deploy config (name, runtime, port) via Gemini Flash
    │
    ▼
generate_code()       Gemini writes app.py, requirements.txt, Procfile, nixpacks.toml
    │                 (brand colors/fonts/tone injected when BrandContext is active)
    ▼
deploy()              Create project → environment → service → git push to Locus
    │
    ▼
poll_until_terminal() Poll deployment status every 20s
    │
    ├── running ──► SUCCESS  emit ROI summary (cost, time saved, AI calls)
    │
    └── failed ──► get_logs() → diagnose_and_heal() → redeploy()  (up to 3×)
```

### Iterative editing flow

```
User edit request  (e.g. "change primary color to deep blue")
    │
    ▼
_iterate_code()       Gemini patches only the affected files, leaves rest unchanged
    │
    ▼
unified diff          Shows exactly what changed before pushing
    │
    ▼
redeploy()            Force-pushes patched source to existing Locus project
    │
    ▼
poll_until_terminal() Same polling loop as initial deploy
    │
    └── running ──► SUCCESS  IteratePanel updates source for next edit
```

Each step streams as a real-time `AgentThought` event to the frontend via SSE.

---

## Features

| Feature | Description |
|---|---|
| Real-time streaming | Every agent step appears live in the terminal UI via SSE |
| Self-healing loop | Auto-diagnoses and patches build failures up to 3× |
| Iterative editing | Chat-driven code changes + redeploy after any successful deployment |
| Brand RAG | Upload PDF/logo → extract hex colors, fonts, tone → inject into generated code |
| GitHub deploy | Paste any public GitHub URL — agent fetches, analyses, and deploys it |
| Cost tracking | Per-session AI call count, USDC spend, and ROI displayed on success |
| Budget gate | Checks Locus wallet balance before each heal attempt |
| Diff viewer | Color-coded unified diff for every patched file |
| Code viewer | Collapsible accordion showing all generated source files |
| Workspace chip | Shows authenticated Locus workspace ID in the header |
| Credits modal | UI to add USDC credits to your Locus wallet |

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/deploy` | SSE stream — deploy from NL prompt or GitHub URL |
| `POST` | `/iterate` | SSE stream — patch + redeploy an existing project |
| `POST` | `/brand/extract` | Upload PDF/image → return `BrandContext` |
| `GET` | `/apps` | List all Locus projects |
| `GET` | `/apps/{id}` | Get deployment status |
| `GET` | `/apps/{id}/logs` | Fetch build + runtime logs |
| `DELETE` | `/apps/{id}` | Tear down a deployed app |
| `GET` | `/balance` | Locus wallet balance |
| `GET` | `/workspace` | Authenticated workspace ID |
| `GET` | `/github/meta` | Public metadata for a GitHub repo URL |
| `GET` | `/health` | Health check |

---

## Demo

1. Open `http://localhost:3000`
2. Type: `Deploy a Python Flask API that returns Hello World on GET /`
3. Watch the agent generate code, push to Locus, and heal any build failures live
4. Once deployed, use the **Iterative Editor** panel to type: `Change the primary color to deep blue`
5. The agent patches the code, shows a diff, and redeploys — no restart needed
