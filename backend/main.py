"""
Locus Auto-Heal — FastAPI backend
Streams AgentThought events to the browser via Server-Sent Events (SSE).
"""

import json
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Dict
import os

from agent import HealAgent
from agent.locus_client import LocusClient
from agent.github_client import GitHubClient, parse_github_url
from agent.brand_extractor import extract_brand
from models.schemas import DeployRequest, IterateRequest


# ── App init ────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    yield  # nothing to set up / tear down for now


app = FastAPI(
    title="Locus Auto-Heal Agent",
    description="Autonomous self-healing deployment agent powered by Locus PaaS + Claude AI",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", os.getenv("FRONTEND_URL", "*")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── SSE helpers ─────────────────────────────────────────────────────────

def sse_event(data: dict, event: str = "message") -> str:
    """Format a single SSE message."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def deploy_stream(request: DeployRequest):
    """
    Drives the HealAgent and converts each AgentThought into an SSE event.
    Handles both natural-language and GitHub-URL deploy requests.
    """
    agent = HealAgent()
    try:
        # Prefer github_url over the legacy github_repo field
        github_url = request.github_url or request.github_repo or None

        async for thought in agent.run(
            natural_language_request=request.natural_language_request,
            source_code=request.source_code,
            github_url=github_url,
            max_heal_attempts=request.max_heal_attempts,
            brand_context=request.brand_context,
        ):
            yield sse_event(thought.model_dump())

        yield sse_event({"type": "done", "message": "Stream complete."}, event="done")

    except Exception as exc:
        import traceback
        detail = str(exc) or repr(exc)
        traceback.print_exc()
        yield sse_event(
            {"type": "error", "message": f"Unexpected agent error: {detail}"},
            event="error",
        )
    finally:
        await agent._locus.close()
        await agent._github.close()


# ── Routes ───────────────────────────────────────────────────────────────

@app.post("/deploy")
async def deploy(request: DeployRequest):
    """
    Accepts a natural-language deploy request and streams AgentThought events
    back via Server-Sent Events until the deployment succeeds or healing fails.
    """
    return StreamingResponse(
        deploy_stream(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",     # Disable nginx buffering
        },
    )


async def iterate_stream(request: IterateRequest):
    agent = HealAgent()
    try:
        async for thought in agent.iterate(
            edit_request=request.edit_request,
            source_code=request.source_code,
            project_id=request.project_id,
            runtime=request.runtime,
            service_url=request.service_url or "",
            brand_context=request.brand_context,
            max_heal_attempts=request.max_heal_attempts,
        ):
            yield sse_event(thought.model_dump())
        yield sse_event({"type": "done", "message": "Stream complete."}, event="done")
    except Exception as exc:
        import traceback; traceback.print_exc()
        yield sse_event({"type": "error", "message": f"Iterate error: {repr(exc)}"}, event="error")
    finally:
        await agent._locus.close()
        await agent._github.close()


@app.post("/iterate")
async def iterate(request: IterateRequest):
    """Apply a natural-language edit to a deployed app and redeploy."""
    return StreamingResponse(
        iterate_stream(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/apps")
async def list_apps():
    """List all deployed Locus apps."""
    client = LocusClient()
    try:
        return await client.list_apps()
    finally:
        await client.close()


@app.get("/apps/{app_id}")
async def get_app(app_id: str):
    """Get status of a specific Locus app."""
    client = LocusClient()
    try:
        return await client.get_status(app_id)
    finally:
        await client.close()


@app.get("/apps/{app_id}/logs")
async def get_logs(app_id: str):
    """Fetch raw logs for a Locus app."""
    client = LocusClient()
    try:
        logs = await client.get_logs(app_id)
        return {"logs": logs}
    finally:
        await client.close()


@app.delete("/apps/{app_id}")
async def delete_app(app_id: str):
    """Tear down a deployed Locus app."""
    client = LocusClient()
    try:
        await client.delete_app(app_id)
        return {"message": f"App {app_id} deleted."}
    finally:
        await client.close()


@app.get("/balance")
async def get_balance():
    """Fetch Locus wallet balance."""
    client = LocusClient()
    try:
        return await client.get_balance()
    finally:
        await client.close()


@app.get("/workspace")
async def get_workspace():
    """Return the authenticated workspace ID (best-effort, no error on auth failure)."""
    client = LocusClient()
    try:
        await client.ensure_auth()
        return {"workspace_id": client._workspace_id}
    except Exception:
        return {"workspace_id": None}
    finally:
        await client.close()


@app.get("/github/meta")
async def github_meta(url: str):
    """
    Fetch public metadata for a GitHub repo URL.
    Used by the frontend to render the repo preview card before deploying.
    """
    try:
        owner, repo, branch, _ = parse_github_url(url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    client = GitHubClient()
    try:
        meta = await client.get_repo_meta(owner, repo)
        meta["branch"] = branch or meta["default_branch"]
        return meta
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"GitHub API error: {exc}")
    finally:
        await client.close()


@app.post("/brand/extract")
async def brand_extract(file: UploadFile = File(...)):
    """
    Upload a PDF of brand guidelines or a logo image.
    Returns structured BrandContext (colors, tone, mission, keywords).
    """
    allowed = {"pdf", "png", "jpg", "jpeg", "webp"}
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in allowed:
        raise HTTPException(status_code=422, detail=f"Unsupported file type .{ext}. Use PDF, PNG, or JPG.")

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:  # 20 MB cap
        raise HTTPException(status_code=413, detail="File too large (max 20 MB).")

    model_name = os.getenv("GEMINI_FAST_MODEL", "gemini-2.0-flash")
    try:
        brand = await extract_brand(content, file.filename or f"upload.{ext}", model_name)
        return brand
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Extraction failed: {exc}")


@app.get("/health")
async def health():
    return {"status": "ok", "service": "locus-auto-heal"}


# ── Dev server entry point ───────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
