# Locus Phoenix 🔥

**Autonomous self-healing deployment agent** — describe your app in plain English, and Locus Phoenix writes the code, deploys it to [Locus Build](https://buildwithlocus.com), and automatically diagnoses and patches every failure until it's live.

Built for the **Locus Paygentics Hackathon #2**.

---

## What it does

1. **Natural language → code** — type "Deploy a Python Flask API that returns Hello World" and Gemini generates all the source files
2. **One-click deploy** — pushes generated code to Locus Build via git, triggers a real containerized deployment
3. **Self-healing loop** — if the build fails, the agent fetches the logs, asks Gemini to diagnose and patch the code, and redeploys automatically (up to 3 attempts)
4. **GitHub deploy** — paste any GitHub repo URL and it fetches, analyses, and deploys it
5. **Payment-aware** — checks your Locus wallet balance before each heal attempt, tracks AI call costs, and shows ROI on success

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 15, React 19, Tailwind CSS, Framer Motion |
| Backend | Python FastAPI, Server-Sent Events (SSE) |
| AI | Google Gemini 2.5 Flash via Locus payment rails |
| PaaS | Locus Build (`buildwithlocus.com`) |
| Payments | Locus wallet (`paywithlocus.com`) |

---

## Project structure

```
LocusHackathon/
├── backend/
│   ├── agent/
│   │   ├── heal_agent.py      # Core autonomous agent logic
│   │   ├── locus_client.py    # Locus Build API client
│   │   ├── github_client.py   # GitHub repo fetcher
│   │   └── prompts.py         # Gemini prompt templates
│   ├── models/
│   │   └── schemas.py         # Pydantic models
│   ├── main.py                # FastAPI app + SSE streaming
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── app/                   # Next.js app router
    ├── components/
    │   ├── ChatTerminal.tsx   # Main terminal UI
    │   ├── ThoughtLine.tsx    # Agent thought renderer
    │   ├── CodeViewer.tsx     # Generated file accordion
    │   ├── DiffViewer.tsx     # Before/after patch diff
    │   ├── CreditsModal.tsx   # Locus wallet top-up UI
    │   └── StatusBadge.tsx    # Thought type badges
    └── lib/
        ├── types.ts
        └── useDeployStream.ts # SSE hook
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
| `GEMINI_MODEL` | No | Model name (default: `gemini-2.5-flash`) |
| `LOCUS_API_KEY` | Yes | Locus `claw_` API key |
| `LOCUS_BUILD_API` | No | Override build API base URL (beta users) |
| `LOCUS_GIT_HOST` | No | Override git push host (beta users) |
| `USE_LOCUS_WRAPPED` | No | Route LLM calls through Locus rails (default: `false`) |
| `GITHUB_TOKEN` | No | GitHub PAT for higher rate limits |

---

## How the agent works

```
User prompt
    │
    ▼
parse_request()     NL → deploy config (name, runtime, port) via Gemini Flash
    │
    ▼
generate_code()     Gemini writes app.py, requirements.txt, Procfile, nixpacks.toml
    │
    ▼
deploy()            Create project → environment → service → git push to Locus
    │
    ▼
poll_until_terminal()   Poll deployment status every 20s
    │
    ├── running ──► SUCCESS  emit ROI summary (cost, time saved, AI calls)
    │
    └── failed ──► get_logs() → diagnose_and_heal() → redeploy()  (up to 3×)
```

Each step streams as a real-time `AgentThought` event to the frontend via SSE.

---

## Features

- **Real-time streaming** — every agent step appears live in the terminal UI
- **Cost tracking** — per-session AI call count, USDC spend, and ROI on success
- **Budget gate** — checks wallet balance before each heal attempt
- **Before/after diff** — shows unified diff of patched files on each heal
- **Generated code viewer** — collapsible accordion showing every generated file
- **GitHub deploy** — paste a repo URL to deploy any public GitHub project
- **Workspace ID** — shows authenticated Locus workspace in the header
- **Credits modal** — UI to add credits to your Locus wallet

---

## Demo

1. Open `http://localhost:3000`
2. Type: `Deploy a Python Flask API that returns Hello World on GET /`
3. Watch the agent generate code, push to Locus, and heal any build failures live
