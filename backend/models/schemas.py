from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from enum import Enum
import time


class DeploymentStatus(str, Enum):
    PENDING = "pending"
    BUILDING = "building"
    RUNNING = "running"
    FAILED = "failed"
    STOPPED = "stopped"


class DeployRequest(BaseModel):
    natural_language_request: str
    source_code: Optional[Dict[str, str]] = None  # filename -> content
    github_repo: Optional[str] = None             # renamed to github_url below for clarity
    github_url: Optional[str] = None              # e.g. https://github.com/owner/repo
    max_heal_attempts: int = 3


class GitHubRepoMeta(BaseModel):
    owner: str
    repo: str
    description: str = ""
    stars: int = 0
    language: str = "Unknown"
    default_branch: str = "main"
    homepage: str = ""
    topics: list = []


class AgentThought(BaseModel):
    type: str  # "thought" | "action" | "success" | "error" | "healing"
    message: str
    metadata: Optional[Dict[str, Any]] = None
    ts: float = Field(default_factory=time.time)


class LocusDeployPayload(BaseModel):
    name: str
    runtime: str                          # e.g. "python3.11", "node20", "static"
    start_command: str
    source_code: Dict[str, str]           # filename -> content
    env_vars: Optional[Dict[str, str]] = {}
    port: Optional[int] = 8080
    region: Optional[str] = "us-east-1"


class DeploymentResult(BaseModel):
    success: bool
    app_id: Optional[str] = None
    url: Optional[str] = None
    attempts: int = 0
    final_status: Optional[str] = None
    thoughts: List[AgentThought] = []
