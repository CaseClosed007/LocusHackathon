"""
GitHubClient — fetches public repo contents via the GitHub REST API.

Strategy:
  1. parse_url()        → extract owner / repo / branch / subdir
  2. get_repo_meta()    → stars, description, default branch, primary language
  3. get_file_tree()    → full recursive path list (filtered)
  4. fetch_config_files() → README, package.json, requirements.txt, etc.
  5. fetch_files()      → fetch a specific list of paths (LLM-chosen)

GitHub unauthenticated rate-limit is 60 req/hr.
Set GITHUB_TOKEN in .env for 5000 req/hr.
"""

import asyncio
import base64
import os
import re
from pathlib import PurePosixPath
from typing import Optional

import httpx

GITHUB_API   = "https://api.github.com"
GITHUB_RAW   = "https://raw.githubusercontent.com"
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")

# Files we always attempt to fetch first so the LLM can analyse the repo
CONFIG_FILES = [
    "README.md", "readme.md", "README.rst", "README",
    "package.json", "package-lock.json",
    "requirements.txt", "requirements-dev.txt",
    "pyproject.toml", "setup.py", "setup.cfg",
    "Pipfile",
    "go.mod",
    "Gemfile",
    "Cargo.toml",
    "Procfile",
    ".python-version", ".nvmrc", "runtime.txt",
    ".env.example", ".env.sample", ".env.template",
    "Dockerfile",
    "docker-compose.yml", "docker-compose.yaml",
    "fly.toml", "render.yaml", "railway.toml",
    "vercel.json", "netlify.toml",
]

# Extensions considered safe / text-readable
TEXT_EXTS = {
    ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
    ".go", ".rb", ".rs", ".java", ".kt", ".swift",
    ".c", ".cpp", ".h", ".hpp",
    ".html", ".htm", ".css", ".scss", ".sass", ".less",
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf",
    ".env", ".example", ".sample", ".template",
    ".txt", ".md", ".rst", ".sh", ".bash", ".zsh",
    ".sql", ".graphql", ".proto",
    "", # no extension — could be Makefile, Procfile, Dockerfile, etc.
}

# Directories that are always skipped
SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", "env",
    "dist", "build", ".next", ".nuxt", "out", "target", "vendor",
    ".cache", "coverage", ".pytest_cache", ".tox", ".eggs",
    ".idea", ".vscode", "*.egg-info",
}

MAX_FILE_SIZE   = 80_000    # bytes — skip files larger than this
MAX_FILES_TOTAL = 30        # maximum source files to ship to Locus


# ── URL parsing ──────────────────────────────────────────────────────

def parse_github_url(url: str) -> tuple[str, str, Optional[str], Optional[str]]:
    """
    Returns (owner, repo, branch, subdir).
    Handles:
      https://github.com/owner/repo
      https://github.com/owner/repo/tree/branch
      https://github.com/owner/repo/tree/branch/some/subdir
      github.com/owner/repo  (without scheme)
    """
    url = url.strip().rstrip("/")
    if not url.startswith("http"):
        url = "https://" + url

    # Remove .git suffix
    url = re.sub(r"\.git$", "", url)

    pattern = r"https?://github\.com/([^/]+)/([^/]+)(?:/tree/([^/]+)(/.*)?)?$"
    m = re.match(pattern, url)
    if not m:
        raise ValueError(f"Cannot parse GitHub URL: {url!r}")

    owner  = m.group(1)
    repo   = m.group(2)
    branch = m.group(3)          # may be None
    subdir = (m.group(4) or "").lstrip("/") or None
    return owner, repo, branch, subdir


# ── Client ───────────────────────────────────────────────────────────

class GitHubClient:

    def __init__(self):
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if GITHUB_TOKEN:
            headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

        self._api = httpx.AsyncClient(
            base_url=GITHUB_API,
            headers=headers,
            timeout=20.0,
        )
        self._raw = httpx.AsyncClient(timeout=20.0)

    # ------------------------------------------------------------------
    # Public helpers
    # ------------------------------------------------------------------

    async def get_repo_meta(self, owner: str, repo: str) -> dict:
        """Repo metadata: description, stars, language, default_branch."""
        resp = await self._api.get(f"/repos/{owner}/{repo}")
        resp.raise_for_status()
        data = resp.json()
        return {
            "owner":          data.get("owner", {}).get("login", owner),
            "repo":           data.get("name", repo),
            "description":    data.get("description") or "",
            "stars":          data.get("stargazers_count", 0),
            "language":       data.get("language") or "Unknown",
            "default_branch": data.get("default_branch", "main"),
            "homepage":       data.get("homepage") or "",
            "topics":         data.get("topics", []),
        }

    async def get_file_tree(
        self, owner: str, repo: str, branch: str
    ) -> list[str]:
        """
        Return all file paths in the repo, filtered to text files only,
        skipping build artefacts and large blobs.
        """
        resp = await self._api.get(
            f"/repos/{owner}/{repo}/git/trees/{branch}",
            params={"recursive": "1"},
        )
        resp.raise_for_status()
        data = resp.json()

        if data.get("truncated"):
            # Very large repo — we'll still work with what we have
            pass

        paths = []
        for item in data.get("tree", []):
            if item.get("type") != "blob":
                continue
            path = item["path"]
            size = item.get("size", 0)

            if size > MAX_FILE_SIZE:
                continue
            if _in_skip_dir(path):
                continue
            ext = PurePosixPath(path).suffix.lower()
            if ext not in TEXT_EXTS:
                continue

            paths.append(path)

        return paths

    async def fetch_config_files(
        self,
        owner: str,
        repo: str,
        branch: str,
        available_paths: list[str],
    ) -> dict[str, str]:
        """
        Fetch priority config files that exist in the repo.
        Returns {path: content} for found files.
        """
        available_set = set(available_paths)
        to_fetch = [p for p in CONFIG_FILES if p in available_set]

        # Also grab any file named exactly like a Dockerfile variant
        to_fetch += [
            p for p in available_paths
            if p.lower() in {"dockerfile", "containerfile"}
            and p not in to_fetch
        ]

        results = await asyncio.gather(
            *[self._fetch_raw(owner, repo, branch, p) for p in to_fetch],
            return_exceptions=True,
        )
        return {
            path: content
            for path, content in zip(to_fetch, results)
            if isinstance(content, str)
        }

    async def fetch_files(
        self,
        owner: str,
        repo: str,
        branch: str,
        paths: list[str],
    ) -> dict[str, str]:
        """Fetch a specific list of file paths. Returns {path: content}."""
        # Cap to MAX_FILES_TOTAL
        paths = paths[:MAX_FILES_TOTAL]

        results = await asyncio.gather(
            *[self._fetch_raw(owner, repo, branch, p) for p in paths],
            return_exceptions=True,
        )
        return {
            path: content
            for path, content in zip(paths, results)
            if isinstance(content, str)
        }

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    async def _fetch_raw(self, owner: str, repo: str, branch: str, path: str) -> str:
        """Fetch a single file via raw.githubusercontent.com."""
        url = f"{GITHUB_RAW}/{owner}/{repo}/{branch}/{path}"
        resp = await self._raw.get(url)
        resp.raise_for_status()
        return resp.text

    async def close(self):
        await asyncio.gather(self._api.aclose(), self._raw.aclose())


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _in_skip_dir(path: str) -> bool:
    parts = PurePosixPath(path).parts
    return any(p in SKIP_DIRS for p in parts)
