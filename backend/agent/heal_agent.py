"""
HealAgent — autonomous deployment + self-healing loop powered by Google Gemini.

Normal flow  (natural language):
  1. parse_request()     → NL → LocusDeployPayload via LLM
  2. generate_code()     → LLM writes the source files (if not provided)
  3 → 6. deploy + poll + heal loop

GitHub flow  (github_url provided):
  1. _fetch_github_repo() → parse URL → fetch tree → fetch files → LLM analysis
  2. _adapt_for_locus()   → LLM patches port-binding / host issues
  3 → 6. same deploy + poll + heal loop
"""

import json
import re
import os
import asyncio
import difflib
import time
from typing import AsyncGenerator, Dict, Optional

import google.generativeai as genai
from google.generativeai.types import GenerationConfig, HarmCategory, HarmBlockThreshold

from .locus_client import LocusClient, LocusAPIError
from .github_client import GitHubClient, parse_github_url
from .prompts import (
    PARSE_DEPLOY_REQUEST_PROMPT,
    GENERATE_CODE_PROMPT,
    ITERATE_CODE_PROMPT,
    DIAGNOSE_AND_HEAL_PROMPT,
    ANALYZE_GITHUB_REPO_PROMPT,
    ADAPT_FOR_LOCUS_PROMPT,
)
from models.schemas import AgentThought, BrandContext, LocusDeployPayload


GEMINI_MODEL       = os.getenv("GEMINI_MODEL", "gemini-2.5-pro-exp-03-25")
GEMINI_FAST_MODEL  = os.getenv("GEMINI_FAST_MODEL", "gemini-2.0-flash")
USE_LOCUS_WRAPPED  = os.getenv("USE_LOCUS_WRAPPED", "true").lower() == "true"


def _thought(type_: str, message: str, **meta) -> AgentThought:
    return AgentThought(type=type_, message=message, metadata=meta or None)


def _extract_files(text: str) -> Dict[str, str]:
    """
    Parse <<<FILE: name>>> ... <<<ENDFILE>>> blocks.
    Falls back to greedy split when the response is truncated (no ENDFILE marker).
    """
    # Primary: strict match with ENDFILE
    pattern = r"<<<FILE:\s*(.+?)>>>\n?(.*?)<<<ENDFILE(?:>>>)?"
    matches = re.findall(pattern, text, re.DOTALL)
    if matches:
        return {name.strip(): content for name, content in matches}

    # Fallback: split on <<<FILE: tags for truncated responses
    parts = re.split(r"<<<FILE:\s*", text)
    files: Dict[str, str] = {}
    for part in parts[1:]:  # first element is text before first tag
        # Extract filename from first line up to >>>
        header_end = part.find(">>>")
        if header_end == -1:
            continue
        filename = part[:header_end].strip()
        content  = part[header_end + 3:].lstrip("\n")
        # Strip trailing ENDFILE if partially present
        content  = re.split(r"<<<ENDFILE", content)[0].rstrip()
        if filename and content:
            files[filename] = content
    if files:
        return files

    raise ValueError(f"No <<<FILE>>> blocks found in LLM response:\n{text[:400]}")


def _fix_json_strings(s: str) -> str:
    """Escape literal newlines/tabs inside JSON string values (common LLM output bug)."""
    out, in_str, esc = [], False, False
    for ch in s:
        if esc:
            out.append(ch); esc = False
        elif ch == "\\" and in_str:
            out.append(ch); esc = True
        elif ch == '"':
            in_str = not in_str; out.append(ch)
        elif in_str and ch == "\n":
            out.append("\\n")
        elif in_str and ch == "\r":
            out.append("\\r")
        elif in_str and ch == "\t":
            out.append("\\t")
        else:
            out.append(ch)
    return "".join(out)


def _extract_json(text: str) -> dict:
    """Strip markdown fences and parse the first JSON object found."""
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("`").strip()
    start = text.find("{")
    end   = text.rfind("}") + 1
    if start == -1 or end == 0:
        raise ValueError(f"No JSON object in LLM response:\n{text[:500]}")
    raw = text[start:end]
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return json.loads(_fix_json_strings(raw))


def _format_tree(paths: list[str], max_lines: int = 200) -> str:
    lines = sorted(paths)[:max_lines]
    suffix = f"\n... and {len(paths) - max_lines} more files" if len(paths) > max_lines else ""
    return "\n".join(lines) + suffix


def _format_config_files(files: dict[str, str], max_chars_each: int = 3000) -> str:
    parts = []
    for path, content in files.items():
        snippet = content[:max_chars_each]
        if len(content) > max_chars_each:
            snippet += f"\n... (truncated)"
        parts.append(f"--- {path} ---\n{snippet}")
    return "\n\n".join(parts) if parts else "(none found)"


# Safety settings — disable all blocks so code generation isn't filtered
_SAFETY = {
    HarmCategory.HARM_CATEGORY_HARASSMENT:        HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH:       HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
}


# Keywords that signal a complex / expensive deployment
_COMPLEX_KEYWORDS = {
    "database", "postgres", "redis", "auth", "authentication", "oauth",
    "websocket", "real-time", "realtime", "machine learning", "ml model",
    "full-stack", "fullstack", "microservice", "queue", "celery", "stripe",
    "payment", "graphql", "elasticsearch", "kafka",
}

# Estimated USDC cost per LLM call
_COST_FAST = 0.0005
_COST_PRO  = 0.003
_COST_SVC  = 0.25   # Locus service creation fee


def _unified_diff(old: str, new: str, filename: str) -> str:
    """Return a unified diff string between old and new file content."""
    return "".join(difflib.unified_diff(
        old.splitlines(keepends=True),
        new.splitlines(keepends=True),
        fromfile=f"a/{filename}",
        tofile=f"b/{filename}",
        n=2,
    ))


class HealAgent:
    """Autonomous deploy-and-heal agent backed by Google Gemini + Locus Build."""

    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY", "")
        genai.configure(api_key=api_key)
        self._model = genai.GenerativeModel(model_name=GEMINI_MODEL,      safety_settings=_SAFETY)
        self._fast_model = genai.GenerativeModel(model_name=GEMINI_FAST_MODEL, safety_settings=_SAFETY)
        self._locus  = LocusClient()
        self._github = GitHubClient()
        # Session spend tracker
        self._session: Dict[str, float] = {
            "ai_calls": 0, "ai_cost": 0.0, "deploy_attempts": 0, "start_ts": time.time(),
        }

    # ── LLM call wrapper ─────────────────────────────────────────────

    async def _llm(
        self,
        prompt: str,
        max_tokens: int = 4096,
        fast: bool = False,
    ) -> str:
        """
        Routes LLM calls through Locus payment infrastructure when available.
        Falls back to direct Gemini SDK if Locus wrapped API fails.
        """
        # Track per-session spend
        self._session["ai_calls"] += 1
        self._session["ai_cost"] += _COST_FAST if fast else _COST_PRO

        model_name = GEMINI_FAST_MODEL if fast else GEMINI_MODEL

        if USE_LOCUS_WRAPPED:
            try:
                return await self._locus.wrapped_llm(
                    prompt=prompt,
                    model=model_name,
                    max_tokens=max_tokens,
                )
            except Exception:
                # Fall back to direct Gemini SDK
                pass

        # Direct Gemini SDK fallback
        model  = self._fast_model if fast else self._model
        config = GenerationConfig(max_output_tokens=max_tokens, temperature=0.15)

        def _call():
            resp = model.generate_content(prompt, generation_config=config)
            return resp.text

        return await asyncio.to_thread(_call)

    async def _get_balance_thought(self) -> Optional[AgentThought]:
        """Fetch Locus wallet balance and return as a thought (best-effort)."""
        try:
            bal = await self._locus.get_balance()
            amount   = bal.get("balance", bal.get("amount", "N/A"))
            currency = bal.get("currency", "USDC")
            return _thought("payment", f"Locus wallet: **{amount} {currency}**", balance=bal)
        except Exception:
            return None

    # ── Public entry point ───────────────────────────────────────────

    async def run(
        self,
        natural_language_request: str,
        source_code: Optional[Dict[str, str]] = None,
        github_url: Optional[str] = None,
        max_heal_attempts: int = 3,
        brand_context: Optional[BrandContext] = None,
    ) -> AsyncGenerator[AgentThought, None]:

        # Show Locus wallet balance at start of every run
        bal_thought = await self._get_balance_thought()
        if bal_thought:
            yield bal_thought

        if github_url:
            async for t in self._github_route(github_url, max_heal_attempts):
                yield t
            return

        # ── NL / source-code route ────────────────────────────────────
        # Cost-aware model selection based on complexity keywords
        req_lower = natural_language_request.lower()
        is_complex = any(kw in req_lower for kw in _COMPLEX_KEYWORDS)
        model_tier = "Pro" if is_complex else "Flash"
        if is_complex:
            yield _thought("thought", f"Complex workload detected → **{model_tier}** model selected for code generation", model_tier=model_tier)
        else:
            yield _thought("thought", f"Analyzing your request with Gemini **{model_tier}** model...")

        try:
            deploy_config = await self._parse_request(natural_language_request)
        except Exception as exc:
            yield _thought("error", f"Could not parse request: {exc}")
            return

        yield _thought(
            "action",
            f"Understood! Preparing **{deploy_config['name']}** ({deploy_config['runtime']})",
            config=deploy_config,
        )

        if brand_context:
            color_preview = "  ".join(brand_context.colors[:4])
            yield _thought(
                "action",
                f"Brand context loaded: **{brand_context.company_name or 'Unknown'}** · "
                f"`{brand_context.tone or 'N/A'}` tone · {len(brand_context.colors)} colors",
                brand=brand_context.model_dump(),
            )

        if not source_code:
            yield _thought("thought", "Generating source code with Gemini...")
            try:
                source_code = await self._generate_code(
                    deploy_config, fast=not is_complex, brand_context=brand_context
                )
                yield _thought(
                    "action",
                    f"Generated: `{', '.join(source_code.keys())}`",
                    files=source_code,
                )
            except Exception as exc:
                yield _thought("error", f"Code generation failed: {exc}")
                return

        payload = LocusDeployPayload(
            name=deploy_config["name"],
            runtime=deploy_config["runtime"],
            start_command=deploy_config["start_command"],
            source_code=source_code,
            port=deploy_config.get("port", 8080),
            env_vars=deploy_config.get("env_vars", {}),
        )

        async for t in self._deploy_loop(payload, max_heal_attempts):
            yield t

    # ── GitHub route ─────────────────────────────────────────────────

    async def _github_route(
        self,
        github_url: str,
        max_heal_attempts: int,
    ) -> AsyncGenerator[AgentThought, None]:

        yield _thought("action", "Fetching repository from GitHub...")

        try:
            owner, repo, branch, subdir = parse_github_url(github_url)
        except ValueError as exc:
            yield _thought("error", str(exc))
            return

        try:
            meta   = await self._github.get_repo_meta(owner, repo)
            branch = branch or meta["default_branch"]
        except Exception as exc:
            yield _thought("error", f"Could not reach GitHub: {exc}")
            return

        yield _thought(
            "action",
            f"Found **{owner}/{repo}** — {meta['language']} · ⭐ {meta['stars']:,} · branch `{branch}`",
            meta=meta,
        )

        yield _thought("thought", "Reading file tree...")
        try:
            tree = await self._github.get_file_tree(owner, repo, branch)
        except Exception as exc:
            yield _thought("error", f"Could not fetch file tree: {exc}")
            return

        if subdir:
            prefix = subdir.rstrip("/") + "/"
            tree = [p[len(prefix):] for p in tree if p.startswith(prefix)]

        yield _thought("thought", f"Found `{len(tree)}` candidate files.")

        yield _thought("thought", "Fetching config & dependency files...")
        try:
            config_files = await self._github.fetch_config_files(owner, repo, branch, tree)
        except Exception as exc:
            yield _thought("error", f"Could not fetch config files: {exc}")
            return

        found = ", ".join(f"`{k}`" for k in config_files) or "none"
        yield _thought("thought", f"Config files: {found}")

        yield _thought("thought", "Analyzing repository with Gemini to determine runtime & entry point...")
        try:
            analysis = await self._analyze_github_repo(
                owner=owner, repo=repo, meta=meta,
                tree=tree, config_files=config_files,
            )
        except Exception as exc:
            yield _thought("error", f"Repo analysis failed: {exc}")
            return

        yield _thought(
            "action",
            f"Detected **{analysis['runtime']}** · start: `{analysis['start_command']}` · port: `{analysis.get('port', 8080)}`",
            analysis=analysis,
        )
        if analysis.get("analysis_notes"):
            yield _thought("thought", f"_{analysis['analysis_notes']}_")

        files_needed: list[str] = analysis.get("files_needed", [])
        if not files_needed:
            yield _thought("error", "Gemini could not identify which files to deploy.")
            return

        yield _thought("action", f"Fetching `{len(files_needed)}` source files from GitHub...")
        try:
            fetch_paths = [f"{subdir}/{f}".lstrip("/") if subdir else f for f in files_needed]
            raw_files   = await self._github.fetch_files(owner, repo, branch, fetch_paths)
        except Exception as exc:
            yield _thought("error", f"Could not fetch source files: {exc}")
            return

        if subdir:
            prefix = subdir.rstrip("/") + "/"
            source_code = {(k[len(prefix):] if k.startswith(prefix) else k): v for k, v in raw_files.items()}
        else:
            source_code = raw_files

        yield _thought("action", f"Downloaded: `{', '.join(source_code.keys())}`")

        yield _thought("thought", "Checking Locus PaaS compatibility (port binding, host, deps)...")
        try:
            patches = await self._adapt_for_locus(
                source_code=source_code,
                runtime=analysis["runtime"],
                start_command=analysis["start_command"],
                port=analysis.get("port", 8080),
            )
        except Exception as exc:
            yield _thought("error", f"Adaptation step failed: {exc}")
            return

        if patches:
            source_code = {**source_code, **patches}
            yield _thought("healing", f"Patched `{', '.join(patches.keys())}` for Locus compatibility.", patched=list(patches.keys()))
        else:
            yield _thought("thought", "No compatibility patches needed.")

        payload = LocusDeployPayload(
            name=analysis["name"],
            runtime=analysis["runtime"],
            start_command=analysis["start_command"],
            source_code=source_code,
            port=analysis.get("port", 8080),
            env_vars=analysis.get("env_vars", {}),
        )

        async for t in self._deploy_loop(payload, max_heal_attempts):
            yield t

    # ── Deploy + Heal loop (shared) ──────────────────────────────────

    async def _deploy_loop(
        self,
        payload: LocusDeployPayload,
        max_heal_attempts: int,
    ) -> AsyncGenerator[AgentThought, None]:

        project_id:    Optional[str] = None
        deployment_id: Optional[str] = None

        for attempt in range(1, max_heal_attempts + 2):
            is_redeploy = attempt > 1

            if is_redeploy:
                # Budget gate: check balance before each heal attempt
                try:
                    bal_data = await self._locus.get_balance()
                    credit = float(bal_data.get("balance", bal_data.get("amount", 0)) or 0)
                    if 0 < credit < _COST_SVC:
                        yield _thought("error", f"Insufficient credits (${credit:.4f} USDC) — need at least ${_COST_SVC:.2f} to attempt healing.")
                        return
                    if credit > 0:
                        yield _thought("payment", f"Balance: **{credit:.4f} USDC** — proceeding with heal attempt {attempt-1}/{max_heal_attempts}", balance=credit)
                except Exception:
                    pass  # Best-effort balance check

                yield _thought("healing", f"Re-deploying with patched code (attempt {attempt-1}/{max_heal_attempts})...")
            else:
                yield _thought("action", "Pushing to Locus Build...")

            try:
                resp = await (
                    self._locus.redeploy(project_id, payload)
                    if project_id else
                    self._locus.deploy(payload)
                )
            except LocusAPIError as exc:
                yield _thought("error", f"Locus API error: {exc.detail}")
                return

            project_id    = resp.get("id") or project_id
            deployment_id = resp.get("deployment_id") or deployment_id
            service_url   = resp.get("url", "")

            yield _thought(
                "action",
                f"Build queued. Deployment `{deployment_id}` — this takes 3-7 min...",
                project_id=project_id, deployment_id=deployment_id,
            )

            if not deployment_id:
                yield _thought("thought", "No deployment ID yet — polling project for status...")

            final_status = "unknown"
            async for status_data in self._locus.poll_until_terminal(deployment_id):
                final_status = status_data.get("status", "unknown").lower()
                build_step   = status_data.get("build_step", status_data.get("status", ""))
                msg = f"Status: **{build_step}**"
                yield _thought("thought", msg, status=final_status)

            if final_status == "running":
                url_part = f" → {service_url}" if service_url else ""
                elapsed = round(time.time() - self._session["start_ts"])
                roi = {
                    "ai_calls":    int(self._session["ai_calls"]),
                    "ai_cost":     round(self._session["ai_cost"], 4),
                    "service_cost": _COST_SVC,
                    "total_cost":  round(self._session["ai_cost"] + _COST_SVC, 4),
                    "time_saved_min": 45,
                    "elapsed_s":   elapsed,
                }
                yield _thought(
                    "success",
                    f"Deployment healthy!{url_part}",
                    project_id=project_id, deployment_id=deployment_id,
                    url=service_url, attempts=attempt,
                    files=payload.source_code,
                    roi=roi,
                )
                return

            if attempt > max_heal_attempts:
                yield _thought("error", f"Deployment failed after {max_heal_attempts} healing attempt(s).")
                return

            yield _thought("healing", "Build failed — fetching logs for diagnosis...")

            try:
                logs = await self._locus.get_logs(deployment_id)
            except LocusAPIError as exc:
                yield _thought("error", f"Could not fetch logs: {exc.detail}")
                return

            trimmed = logs[-6000:] if len(logs) > 6000 else logs
            yield _thought("healing", f"Gemini diagnosing error in `{len(trimmed)}` chars of logs...", log_snippet=trimmed[-500:])

            try:
                patched = await self._diagnose_and_heal(
                    logs=trimmed,
                    source_code=payload.source_code,
                    runtime=payload.runtime,
                )
            except Exception as exc:
                yield _thought("error", f"Healing LLM failed: {exc}")
                return

            changed = list(patched.keys())
            merged  = {**payload.source_code, **patched}
            diff_data = {
                f: _unified_diff(payload.source_code.get(f, ""), patched[f], f)
                for f in patched
                if payload.source_code.get(f, "") != patched.get(f, "")
            }
            yield _thought(
                "healing",
                f"Patch ready — modified: `{', '.join(changed)}`",
                patched_files=changed,
                files=merged,
                diff=diff_data,
            )
            payload.source_code = merged

        yield _thought("error", "Exhausted all healing attempts.")

    # ── LLM helpers ──────────────────────────────────────────────────

    async def _parse_request(self, request: str) -> dict:
        text = await self._llm(
            PARSE_DEPLOY_REQUEST_PROMPT.format(request=request),
            max_tokens=1024, fast=True,
        )
        return _extract_json(text)

    async def _generate_code(
        self, config: dict, fast: bool = False, brand_context: Optional[BrandContext] = None
    ) -> Dict[str, str]:
        brand_section = ""
        if brand_context:
            lines = ["=== BRAND GUIDELINES (apply to every generated file) ==="]

            if brand_context.company_name:
                lines.append(f"Company: {brand_context.company_name}")
            if brand_context.tagline:
                lines.append(f"Tagline: \"{brand_context.tagline}\"")
            if brand_context.mission:
                lines.append(f"Mission: {brand_context.mission}")
            if brand_context.tone:
                lines.append(f"Tone of voice: {brand_context.tone}")
            if brand_context.target_audience:
                lines.append(f"Target audience: {brand_context.target_audience}")
            if brand_context.ui_style:
                lines.append(f"Visual style: {brand_context.ui_style}")

            if brand_context.colors:
                roles = brand_context.color_roles or {}
                color_lines = []
                for c in brand_context.colors:
                    role = roles.get(c, "")
                    color_lines.append(f"{c} ({role})" if role else c)
                lines.append(f"Brand colors: {', '.join(color_lines)}")

                # Emit CSS custom properties block
                css_vars = []
                role_order = ["primary", "secondary", "accent", "background", "text"]
                assigned: dict[str, str] = {}
                for color in brand_context.colors:
                    role = roles.get(color, "")
                    if role and role not in assigned:
                        assigned[role] = color
                # Fill missing roles by position
                unnamed = [c for c in brand_context.colors if not roles.get(c)]
                fallback_roles = [r for r in role_order if r not in assigned]
                for i, c in enumerate(unnamed[:len(fallback_roles)]):
                    assigned[fallback_roles[i]] = c

                for role in role_order:
                    if role in assigned:
                        css_vars.append(f"  --color-{role}: {assigned[role]};")
                if css_vars:
                    lines.append(
                        "Use these CSS custom properties in :root {}:\n"
                        + "\n".join(css_vars)
                    )

            if brand_context.fonts:
                font_names = [f if isinstance(f, str) else f.get("name", "") for f in brand_context.fonts]  # type: ignore
                font_names = [f for f in font_names if f]
                lines.append(f"Typography: {', '.join(font_names)}")
                google_fonts = "+".join(f.replace(" ", "+") for f in font_names[:2])
                lines.append(
                    f"Import via Google Fonts: "
                    f"https://fonts.googleapis.com/css2?family={google_fonts}&display=swap"
                )

            if brand_context.keywords:
                lines.append(f"Brand personality: {', '.join(brand_context.keywords)}")

            if brand_context.design_rules:
                lines.append("Design rules to follow:")
                for rule in brand_context.design_rules:
                    lines.append(f"  - {rule}")

            lines.append(
                "\nAPPLY ALL OF THE ABOVE: use exact brand colors as CSS variables, "
                "import and use the specified fonts, reflect the tone in all copy, "
                "and follow every design rule listed.\n"
            )
            brand_section = "\n".join(lines) + "\n"

        # Static sites with brand guidelines need more tokens for full HTML/CSS
        is_static = config.get("runtime", "") == "static"
        gen_tokens = 16000 if (is_static or brand_section) else 8192

        text = await self._llm(
            GENERATE_CODE_PROMPT.format(
                description=config.get("description", config.get("name")),
                runtime=config["runtime"],
                start_command=config["start_command"],
                entrypoint=config.get("suggested_entrypoint", "main.py"),
                brand_section=brand_section,
            ),
            max_tokens=gen_tokens,
            fast=fast,
        )
        return _extract_files(text)

    async def _analyze_github_repo(
        self,
        owner: str, repo: str,
        meta: dict, tree: list[str],
        config_files: dict[str, str],
    ) -> dict:
        text = await self._llm(
            ANALYZE_GITHUB_REPO_PROMPT.format(
                owner=owner, repo=repo,
                description=meta.get("description", ""),
                language=meta.get("language", "Unknown"),
                topics=", ".join(meta.get("topics", [])) or "none",
                file_tree=_format_tree(tree),
                config_files=_format_config_files(config_files),
            ),
            max_tokens=2048, fast=True,
        )
        return _extract_json(text)

    async def _adapt_for_locus(
        self,
        source_code: Dict[str, str],
        runtime: str, start_command: str, port: int,
    ) -> Dict[str, str]:
        trimmed     = {k: v[:3000] for k, v in source_code.items()}
        source_dump = json.dumps(trimmed, indent=2)
        text = await self._llm(
            ADAPT_FOR_LOCUS_PROMPT.format(
                runtime=runtime,
                start_command=start_command,
                port=port,
                source_files=source_dump,
            ),
            max_tokens=4096,
        )
        return _extract_json(text)

    async def _diagnose_and_heal(
        self,
        logs: str,
        source_code: Dict[str, str],
        runtime: str,
    ) -> Dict[str, str]:
        text = await self._llm(
            DIAGNOSE_AND_HEAL_PROMPT.format(
                logs=logs,
                source_code=json.dumps(source_code, indent=2),
                runtime=runtime,
            ),
            max_tokens=8192,
        )
        return _extract_files(text)

    # ── Iterative editing ────────────────────────────────────────────────

    async def iterate(
        self,
        edit_request: str,
        source_code: Dict[str, str],
        project_id: str,
        runtime: str,
        service_url: str = "",
        brand_context: Optional[BrandContext] = None,
        max_heal_attempts: int = 2,
    ) -> AsyncGenerator[AgentThought, None]:
        """Apply a natural-language edit to existing source code and redeploy."""

        self._session["start_ts"] = time.time()

        yield _thought("thought", f"Applying edit: _{edit_request}_")

        # Build brand section (same logic as _generate_code)
        brand_section = ""
        if brand_context and brand_context.colors:
            brand_section = (
                "\n=== ACTIVE BRAND CONTEXT ===\n"
                f"Company: {brand_context.company_name}\n"
                f"Colors: {', '.join(brand_context.colors[:4])}\n"
                f"Tone: {brand_context.tone}\n"
            )

        try:
            patched = await self._iterate_code(
                edit_request, source_code, runtime, brand_section
            )
        except Exception as exc:
            yield _thought("error", f"Could not generate edit: {exc}")
            return

        changed = list(patched.keys())
        merged  = {**source_code, **patched}
        diff_data = {
            f: _unified_diff(source_code.get(f, ""), patched[f], f)
            for f in patched
            if source_code.get(f, "") != patched.get(f, "")
        }

        yield _thought(
            "healing",
            f"Edit ready — modified: `{', '.join(changed)}`",
            patched_files=changed,
            files=merged,
            diff=diff_data,
        )

        # Redeploy via git push to the existing project
        yield _thought("action", "Redeploying with changes...")
        payload = LocusDeployPayload(
            name=project_id,
            runtime=runtime,
            start_command="",
            source_code=merged,
        )

        try:
            resp = await self._locus.redeploy(project_id, payload)
        except LocusAPIError as exc:
            yield _thought("error", f"Redeploy failed: {exc.detail}")
            return

        deployment_id = resp.get("deployment_id", "")
        url           = resp.get("url", service_url)

        if not deployment_id:
            # No deployment ID — likely a static/git-only project; treat as done
            yield _thought(
                "success",
                "Edit applied! Redeploy triggered.",
                project_id=project_id,
                url=url,
                files=merged,
            )
            return

        yield _thought(
            "action",
            f"Redeploy queued — `{deployment_id}` — this takes 3-7 min...",
            deployment_id=deployment_id,
        )

        final_status = "unknown"
        async for status_data in self._locus.poll_until_terminal(deployment_id):
            final_status = status_data.get("status", "unknown").lower()
            yield _thought("thought", f"Status: **{status_data.get('build_step', final_status)}**")

        if final_status == "running":
            elapsed = round(time.time() - self._session["start_ts"])
            yield _thought(
                "success",
                f"Edit live!{' → ' + url if url else ''}",
                project_id=project_id,
                deployment_id=deployment_id,
                url=url,
                files=merged,
                elapsed_s=elapsed,
            )
        else:
            yield _thought("error", f"Redeploy ended with status: {final_status}")

            # One auto-heal attempt for iterate failures
            if max_heal_attempts > 0:
                yield _thought("healing", "Auto-healing redeploy failure...")
                try:
                    logs = await self._locus.get_logs(deployment_id)
                    healed = await self._diagnose_and_heal(logs, merged, runtime)
                    merged = {**merged, **healed}
                    payload.source_code = merged
                    yield _thought("healing", f"Patch applied: `{', '.join(healed.keys())}`", files=merged)
                    resp2 = await self._locus.redeploy(project_id, payload)
                    yield _thought("action", f"Re-queued: `{resp2.get('deployment_id', '')}`")
                except Exception as exc:
                    yield _thought("error", f"Auto-heal failed: {exc}")

    async def _iterate_code(
        self,
        edit_request: str,
        source_code: Dict[str, str],
        runtime: str,
        brand_section: str = "",
    ) -> Dict[str, str]:
        # Trim each file to 6000 chars to stay within context window
        trimmed = {k: v[:6000] + ("\n...(truncated)" if len(v) > 6000 else "")
                   for k, v in source_code.items()}
        text = await self._llm(
            ITERATE_CODE_PROMPT.format(
                source_code=json.dumps(trimmed, indent=2),
                edit_request=edit_request,
                runtime=runtime,
                brand_section=brand_section,
            ),
            max_tokens=16000,
        )
        return _extract_files(text)

    async def close(self):
        await self._github.close()
