PARSE_DEPLOY_REQUEST_PROMPT = """You are an expert DevOps engineer. The user wants to deploy an application using natural language.

Analyze their request and return a JSON object with ONLY these fields:
{{
  "name": "<slug-style-app-name, lowercase-hyphenated>",
  "runtime": "<one of: python3.11, node20, node18, static, go1.21, ruby3.2>",
  "start_command": "<the command to start the app, e.g. 'python main.py' or 'node index.js' or 'npm start'>",
  "port": <integer port number, default 8080>,
  "env_vars": {{}},
  "suggested_entrypoint": "<the main filename that should exist, e.g. main.py or index.js>",
  "description": "<one-sentence summary of what this app does>"
}}

User request: {request}

Respond with ONLY valid JSON, no markdown, no explanation."""


GENERATE_CODE_PROMPT = """You are an expert software engineer. Generate a complete, working application based on this description.

App description: {description}
Runtime: {runtime}
Start command: {start_command}
Entry point file: {entrypoint}

Return the files using EXACTLY this block format — one block per file:

<<<FILE: filename>>>
complete file content here
<<<ENDFILE>>>

Rules:
- The app MUST include a GET /health endpoint that returns HTTP 200 and JSON {{"status":"ok"}}
- The app MUST listen on the PORT environment variable (default 8080), bound to 0.0.0.0
- Include ALL necessary files (requirements.txt, package.json, Procfile, etc.)
- Include a Procfile with: web: <start command>
- ALWAYS include a nixpacks.toml with:
  [start]
  cmd = "<the start command>"
- Keep it minimal but functional
- For Python web apps use Flask or FastAPI with gunicorn
- For Node apps use Express

Output ONLY the file blocks, no explanation, no markdown."""


DIAGNOSE_AND_HEAL_PROMPT = """You are an elite DevOps engineer. A deployment failed. Output ONLY fixed file blocks — no explanation, no preamble, no diagnosis text.

=== BUILD LOGS ===
{logs}

=== CURRENT SOURCE CODE ===
{source_code}

=== RUNTIME ===
{runtime}

=== COMMON FIXES ===
- "No start command could be found" or Nixpacks errors → ADD a nixpacks.toml:
  [start]
  cmd = "<the start command>"
  Also ensure Procfile exists with: web: <start command>
- Missing package → add to requirements.txt / package.json
- Wrong port → use os.environ.get('PORT', '8080') bound to 0.0.0.0
- Import error → fix import or add dependency

Return ONLY the files that need to change, using EXACTLY this format:

<<<FILE: filename>>>
complete new file content
<<<ENDFILE>>>

IMPORTANT: Your response must start with <<<FILE: and contain ONLY file blocks. No text before or after."""


# ── GitHub-specific prompts ──────────────────────────────────────────

ANALYZE_GITHUB_REPO_PROMPT = """You are an expert DevOps engineer analyzing a GitHub repository to deploy it.

=== REPOSITORY METADATA ===
Owner: {owner}
Repo:  {repo}
Description: {description}
Primary Language: {language}
Topics: {topics}

=== FILE TREE (filtered, text files only) ===
{file_tree}

=== KEY CONFIG FILE CONTENTS ===
{config_files}

Analyze this repository and return a JSON object with EXACTLY these fields:
{{
  "name": "<slug-style app name derived from repo name, lowercase-hyphenated, max 40 chars>",
  "runtime": "<one of EXACTLY: python3.11, node20, node18, static, go1.21, ruby3.2>",
  "start_command": "<exact command to start the server, e.g. 'python app.py' or 'node server.js' or 'npm start'>",
  "port": <integer, default 8080 — use the port the app actually listens on>,
  "env_vars": {{"KEY": "example_value_or_empty"}},
  "files_needed": ["list", "of", "file", "paths", "from", "the", "tree", "needed", "to", "run", "the", "app"],
  "description": "<one-sentence description of what this app does>",
  "analysis_notes": "<brief explanation of your runtime/command choices>"
}}

Rules for files_needed:
- Include ALL source files required to run the app (entry point, imports, templates, etc.)
- Include dependency files (requirements.txt, package.json, go.mod, etc.)
- Include static assets ONLY if they are referenced by the app
- EXCLUDE: tests, docs, .github/**, *.md (except if the app serves them), CI configs
- Maximum 30 files

Rules for start_command:
- Must work WITHOUT a virtual environment being activated (use 'python' not 'python3')
- For Node: prefer 'node index.js' or 'npm start' if package.json has a start script
- For Python: check if there's a Procfile and use its web: command if present
- The app MUST read PORT from environment: os.environ.get('PORT', '8080') or process.env.PORT

Respond with ONLY valid JSON, no markdown fences, no explanation."""


ADAPT_FOR_LOCUS_PROMPT = """You are an expert DevOps engineer. A GitHub repository's source files need minor adaptation to run on Locus PaaS.

=== APP CONFIG ===
Runtime: {runtime}
Start command: {start_command}
Port: {port}

=== SOURCE FILES ===
{source_files}

Review EVERY file and fix ONLY what is required to run on Locus:
1. The app must read its port from the PORT environment variable (os.environ.get('PORT', '8080') / process.env.PORT || 8080)
2. The app must bind to host 0.0.0.0 (not 127.0.0.1 or localhost)
3. Remove any hardcoded local filesystem paths that won't exist on the server
4. If requirements.txt / package.json is missing but imports are present, CREATE it

Return a JSON object with the complete contents of ONLY the files that needed changes (or new files created).
Format: {{"filename": "complete new file content", ...}}

If NO changes are needed, return an empty object: {{}}

Respond with ONLY valid JSON, no markdown fences, no explanation."""
