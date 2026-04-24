"""
Locus Build client — deploys real containerized services via buildwithlocus.com.

Auth flow:
  POST /v1/auth/exchange  →  JWT token (30-day expiry)
  GET  /v1/auth/whoami    →  workspaceId

Deploy flow (generated source code):
  1. POST /v1/projects                         — create project
  2. POST /v1/projects/{id}/environments       — create production env
  3. POST /v1/services  (source.type = "s3")   — create service
  4. git push to Locus remote                  — triggers deployment
  5. GET  /v1/deployments/{id}/status          — poll until healthy/failed
  6. GET  /v1/deployments/{id}/logs            — on failure, fetch logs
"""

import asyncio
import os
import re
import subprocess
import tempfile
import httpx
from typing import AsyncGenerator, Optional

from models.schemas import DeploymentStatus, LocusDeployPayload


LOCUS_KEY    = os.getenv("LOCUS_API_KEY", "")
BUILD_API    = os.getenv("LOCUS_BUILD_API",  "https://api.buildwithlocus.com/v1")
GIT_HOST     = os.getenv("LOCUS_GIT_HOST",   "https://git.buildwithlocus.com")
PAYMENT_API  = os.getenv("LOCUS_API_BASE_URL", "https://api.paywithlocus.com/api")

POLL_INTERVAL = 20   # seconds between status polls
POLL_TIMEOUT  = 600  # 10-minute hard cap (builds take 3-7 min)


class LocusAPIError(Exception):
    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail      = detail
        super().__init__(f"Locus {status_code}: {detail}")


class LocusClient:
    """Async client for the Locus Build PaaS API."""

    def __init__(self):
        self._http         = httpx.AsyncClient(base_url=BUILD_API, timeout=30.0)
        self._token:        str = ""
        self._workspace_id: str = ""
        self._api_key       = LOCUS_KEY

    # ── Auth ─────────────────────────────────────────────────────────────

    async def ensure_auth(self) -> None:
        """Exchange claw_ API key for JWT and cache workspace ID."""
        if self._token:
            return
        resp = await self._http.post(
            "/auth/exchange",
            json={"apiKey": self._api_key},
        )
        self._raise_for_status(resp)
        self._token = resp.json()["token"]
        self._http.headers.update({"Authorization": f"Bearer {self._token}"})

        whoami = await self._http.get("/auth/whoami")
        self._raise_for_status(whoami)
        self._workspace_id = whoami.json()["workspaceId"]

    # ── Billing ──────────────────────────────────────────────────────────

    async def get_balance(self) -> dict:
        """GET /v1/billing/balance — Locus wallet/credit balance."""
        try:
            await self.ensure_auth()
            resp = await self._http.get("/billing/balance")
            if resp.status_code < 400:
                data = resp.json()
                return {
                    "balance":  data.get("creditBalance", "N/A"),
                    "currency": "USDC",
                    "services": data.get("totalServices", 0),
                    "warnings": data.get("warnings", []),
                }
        except Exception:
            pass
        return {"balance": "N/A", "currency": "USDC"}

    # ── Deployment lifecycle ─────────────────────────────────────────────

    async def deploy(self, payload: LocusDeployPayload) -> dict:
        """
        Full deploy flow for AI-generated source code:
          create project → environment → git push → return deployment info
        """
        await self.ensure_auth()

        # 1. Create project
        proj_resp = await self._http.post(
            "/projects",
            json={"name": payload.name, "description": "Auto-deployed by Locus Phoenix"},
        )
        self._raise_for_status(proj_resp)
        project_data = proj_resp.json()
        project_id   = project_data["id"]
        service_url  = project_data.get("url", "")

        # 2. Create production environment
        env_resp = await self._http.post(
            f"/projects/{project_id}/environments",
            json={"name": "production", "type": "production"},
        )
        self._raise_for_status(env_resp)

        # 3. Git push source code → Locus auto-provisions service + triggers deployment
        deployment_ids = await self._git_push(project_id, payload.source_code)

        if deployment_ids:
            deployment_id = deployment_ids[0]
        else:
            # Wait briefly for Locus to process the push before querying
            await asyncio.sleep(5)
            deployment_id = await self._latest_deployment_by_project(project_id)

        # Last resort: return project_id as stand-in so polling can try
        if not deployment_id:
            deployment_id = project_id

        return {
            "id":            project_id,
            "deployment_id": deployment_id,
            "url":           service_url,
            "status":        "building",
        }

    async def redeploy(self, project_id: str, payload: LocusDeployPayload) -> dict:
        """
        Redeploy patched source code to an existing project.
        Git push to the same project triggers new deployments for all services.
        """
        await self.ensure_auth()

        deployment_ids = await self._git_push(project_id, payload.source_code)

        if deployment_ids:
            deployment_id = deployment_ids[0]
        else:
            deployment_id = await self._latest_deployment_by_project(project_id)

        return {
            "id":            project_id,
            "deployment_id": deployment_id,
            "url":           "",
            "status":        "building",
        }

    # ── Status & logs ────────────────────────────────────────────────────

    async def get_status(self, deployment_id: str) -> dict:
        """GET /v1/deployments/{id} — current deployment status."""
        await self.ensure_auth()
        resp = await self._http.get(f"/deployments/{deployment_id}")
        self._raise_for_status(resp)
        data   = resp.json()
        status = data.get("status", "unknown").lower()

        # Normalise Locus status → our DeploymentStatus vocabulary
        status_map = {
            "healthy":  DeploymentStatus.RUNNING,
            "failed":   DeploymentStatus.FAILED,
            "cancelled": DeploymentStatus.STOPPED,
            "rolled_back": DeploymentStatus.STOPPED,
        }
        normalised = status_map.get(status, status)
        return {**data, "status": normalised, "build_step": status}

    async def get_logs(self, deployment_id: str) -> str:
        """GET /v1/deployments/{id}/logs — build + runtime logs."""
        await self.ensure_auth()
        resp = await self._http.get(f"/deployments/{deployment_id}/logs")
        if resp.status_code >= 400:
            # Fallback: lastLogs from deployment detail
            detail = await self._http.get(f"/deployments/{deployment_id}")
            if detail.status_code < 400:
                lines = detail.json().get("lastLogs", [])
                return "\n".join(lines)
            return "(no logs available)"
        data = resp.json()
        if isinstance(data, list):
            return "\n".join(str(l) for l in data)
        if isinstance(data, dict):
            return data.get("logs") or "\n".join(data.get("lines", []))
        return str(data)

    # ── Polling ──────────────────────────────────────────────────────────

    async def poll_until_terminal(
        self, deployment_id: str
    ) -> AsyncGenerator[dict, None]:
        """Yield status dicts every POLL_INTERVAL seconds until terminal state."""
        elapsed = 0
        while elapsed < POLL_TIMEOUT:
            try:
                status_data = await self.get_status(deployment_id)
            except Exception:
                await asyncio.sleep(POLL_INTERVAL)
                elapsed += POLL_INTERVAL
                continue

            yield status_data
            status = status_data.get("status", "").lower()
            if status in (
                DeploymentStatus.RUNNING,
                DeploymentStatus.FAILED,
                DeploymentStatus.STOPPED,
            ):
                return

            await asyncio.sleep(POLL_INTERVAL)
            elapsed += POLL_INTERVAL

        raise TimeoutError(f"Deployment {deployment_id} did not complete within {POLL_TIMEOUT}s")

    # ── App management ───────────────────────────────────────────────────

    async def list_apps(self) -> list:
        await self.ensure_auth()
        resp = await self._http.get("/projects")
        self._raise_for_status(resp)
        return resp.json().get("projects", [])

    async def delete_app(self, project_id: str) -> None:
        await self.ensure_auth()
        resp = await self._http.delete(f"/projects/{project_id}")
        if resp.status_code not in (200, 204):
            self._raise_for_status(resp)

    # ── Git push ─────────────────────────────────────────────────────────

    async def _git_push(
        self, project_id: str, source_code: dict[str, str]
    ) -> list[str]:
        """
        Write source files to a temp dir and git-push to the Locus remote.
        Returns list of deployment IDs parsed from git output.
        """
        git_remote = (
            f"https://x:{self._api_key}@"
            f"{GIT_HOST.removeprefix('https://')}/"
            f"{self._workspace_id}/{project_id}.git"
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            # Write all source files
            for filename, content in source_code.items():
                filepath = os.path.join(tmpdir, filename)
                os.makedirs(os.path.dirname(filepath), exist_ok=True)
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(content)

            # Init git repo and push
            git_output = await self._run_git(tmpdir, git_remote)

        # Parse deployment IDs from output lines like: "  -> web [deploy_abc123]"
        ids = re.findall(r"\[([a-zA-Z0-9_]+)\]", git_output)
        return ids

    async def _run_git(self, tmpdir: str, remote_url: str) -> str:
        """Run git init / commit / push in tmpdir. Returns combined stdout+stderr."""
        env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        cmds = [
            ["git", "init", "-b", "main"],
            ["git", "config", "user.email", "agent@phoenix.locus"],
            ["git", "config", "user.name", "Locus Phoenix Agent"],
            ["git", "add", "."],
            ["git", "commit", "-m", "Deploy via Locus Phoenix"],
            ["git", "remote", "add", "locus", remote_url],
            ["git", "push", "--force", "locus", "main"],
        ]
        output_lines = []
        for cmd in cmds:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=tmpdir,
                env=env,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            out = (stdout + stderr).decode("utf-8", errors="replace")
            output_lines.append(out)
            if proc.returncode != 0 and cmd[1] == "push":
                raise LocusAPIError(500, f"git push failed:\n{out}")
        return "\n".join(output_lines)

    async def _latest_deployment_id(self, service_id: str) -> str:
        """Fallback: list deployments for a service and return the newest ID."""
        try:
            resp = await self._http.get(
                "/deployments", params={"serviceId": service_id, "limit": 1}
            )
            if resp.status_code < 400:
                deploys = resp.json().get("deployments", [])
                if deploys:
                    return deploys[0]["id"]
        except Exception:
            pass
        return ""

    async def _latest_deployment_by_project(self, project_id: str) -> str:
        """Fallback: list deployments for a project and return the newest ID."""
        try:
            resp = await self._http.get(
                "/deployments", params={"projectId": project_id, "limit": 1}
            )
            if resp.status_code < 400:
                deploys = resp.json().get("deployments", [])
                if deploys:
                    return deploys[0]["id"]
        except Exception:
            pass
        return ""

    # ── Helpers ──────────────────────────────────────────────────────────

    @staticmethod
    def _raise_for_status(resp: httpx.Response) -> None:
        if resp.status_code >= 400:
            try:
                body = resp.json()
                detail = (
                    body.get("message")
                    or body.get("detail")
                    or body.get("error")
                    or resp.text
                )
            except Exception:
                detail = resp.text
            raise LocusAPIError(resp.status_code, detail)

    async def close(self):
        await self._http.aclose()
