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


class BrandContext(BaseModel):
    company_name: str = ""
    tagline: str = ""
    mission: str = ""
    tone: str = ""                  # e.g. "professional and authoritative"
    target_audience: str = ""       # e.g. "young professionals aged 25-35"
    ui_style: str = ""              # e.g. "minimal", "bold", "playful", "luxury"
    colors: List[str] = []          # hex codes — primary first
    color_roles: Dict[str, str] = {}  # e.g. {"#1a2b3c": "primary", "#ff6600": "accent"}
    fonts: List[str] = []           # font names e.g. ["Inter", "Playfair Display"]
    keywords: List[str] = []        # brand values / keywords
    design_rules: List[str] = []    # explicit DOs/DON'Ts from guidelines
    raw_excerpt: str = ""


class DeployRequest(BaseModel):
    natural_language_request: str
    source_code: Optional[Dict[str, str]] = None
    github_repo: Optional[str] = None
    github_url: Optional[str] = None
    max_heal_attempts: int = 3
    brand_context: Optional[BrandContext] = None


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
