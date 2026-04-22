"""
Brand RAG extractor — parses PDF / image files and uses Gemini to extract
structured brand context (colors, tone, mission, fonts, design rules, etc.).

Pipeline:
  1. PDF  → extract text + mine hex/RGB color values from the text itself
  2. Image → extract dominant colors via Pillow + Gemini vision for text
  3. Both  → send full extracted text to Gemini for deep structured analysis
  4. Merge LLM output with directly-mined colors (PDF text values are authoritative)
"""

import asyncio
import base64
import io
import json
import re
from collections import Counter
from typing import Optional

import google.generativeai as genai
from google.generativeai.types import GenerationConfig, HarmCategory, HarmBlockThreshold

from models.schemas import BrandContext


_SAFETY = {
    HarmCategory.HARM_CATEGORY_HARASSMENT:        HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_HATE_SPEECH:       HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT: HarmBlockThreshold.BLOCK_NONE,
    HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT: HarmBlockThreshold.BLOCK_NONE,
}

BRAND_EXTRACT_PROMPT = """You are a senior brand strategist and UI/UX designer.
Analyse the brand document below and extract every piece of information that would help a developer build a pixel-perfect, on-brand website.

=== DOCUMENT TEXT ===
{text}

Return a JSON object with EXACTLY these fields (use empty string / empty array if genuinely not present — never omit a field):
{{
  "company_name":    "<brand or company name>",
  "tagline":         "<official tagline or slogan>",
  "mission":         "<one-sentence mission or value proposition>",
  "tone":            "<tone of voice — e.g. 'warm and conversational', 'bold and authoritative'>",
  "target_audience": "<primary audience — e.g. 'health-conscious millennials', 'enterprise CTOs'>",
  "ui_style":        "<overall visual aesthetic — choose one: minimal | bold | playful | luxury | corporate | technical | organic>",
  "colors": [
    {{"hex": "<#RRGGBB>", "role": "<primary|secondary|accent|background|text>", "name": "<color name if given>"}}
  ],
  "fonts": [
    {{"name": "<font family name>", "role": "<heading|body|accent>", "style": "<serif|sans-serif|monospace|display>"}}
  ],
  "keywords":      ["<brand value or personality word>"],
  "design_rules":  ["<specific DOs or DON'Ts from the guidelines, e.g. 'Never use the logo on a busy background'>"],
  "imagery_style": "<description of preferred imagery — e.g. 'candid real people, natural lighting, warm tones'>"
}}

Rules:
- colors: extract ALL hex/RGB values mentioned. If none given, infer 3-5 brand-appropriate colors from the document context.
- fonts: if not explicitly stated, infer appropriate Google Fonts based on the brand personality.
- design_rules: pull any explicit rules, spacing guidelines, logo usage rules, or forbidden combinations.
- Be specific and actionable — this output will be fed directly into a website code generator.
- Respond with ONLY valid JSON, no markdown fences, no explanation."""


# ── PDF extraction ────────────────────────────────────────────────────────────

def _extract_pdf_text(pdf_bytes: bytes) -> str:
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        texts = []
        for page in reader.pages[:20]:
            t = page.extract_text()
            if t:
                texts.append(t)
        return "\n".join(texts)[:12000]
    except Exception as exc:
        raise ValueError(f"Could not read PDF: {exc}")


def _mine_hex_colors(text: str) -> list[str]:
    """Extract hex color codes directly from document text — authoritative source."""
    # Match #RGB, #RRGGBB (but not things like #heading-1)
    found = re.findall(r'#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})\b', text)
    # Normalise 3-digit to 6-digit
    normalized = []
    for h in found:
        if len(h) == 4:  # #RGB
            h = "#" + h[1]*2 + h[2]*2 + h[3]*2
        normalized.append(h.lower())
    # Deduplicate while preserving order
    seen = set()
    unique = []
    for c in normalized:
        if c not in seen and not _is_near_white(c) and not _is_near_black(c):
            seen.add(c)
            unique.append(c)
    return unique[:10]


def _mine_rgb_colors(text: str) -> list[str]:
    """Extract rgb(r,g,b) values from document text."""
    matches = re.findall(r'rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)', text, re.IGNORECASE)
    colors = []
    for r, g, b in matches:
        r, g, b = int(r), int(g), int(b)
        if not (r > 230 and g > 230 and b > 230) and not (r < 25 and g < 25 and b < 25):
            colors.append(f"#{r:02x}{g:02x}{b:02x}")
    return colors[:5]


# ── Image extraction ──────────────────────────────────────────────────────────

def _extract_image_colors(image_bytes: bytes, n: int = 6) -> list[str]:
    """Extract dominant non-white/non-black colors from an image."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img = img.resize((200, 200))
        pixels = list(img.getdata())
        counts = Counter(pixels)
        colors: list[str] = []
        for (r, g, b), _ in counts.most_common(300):
            if r > 230 and g > 230 and b > 230:
                continue
            if r < 25 and g < 25 and b < 25:
                continue
            hex_col = f"#{r:02x}{g:02x}{b:02x}"
            if not any(_color_distance((r, g, b), _hex_to_rgb(c)) < 35 for c in colors):
                colors.append(hex_col)
            if len(colors) >= n:
                break
        return colors
    except Exception:
        return []


# ── Gemini calls ──────────────────────────────────────────────────────────────

def _call_gemini(prompt: str, model_name: str) -> str:
    model = genai.GenerativeModel(model_name=model_name, safety_settings=_SAFETY)
    config = GenerationConfig(max_output_tokens=2048, temperature=0.1)
    resp = model.generate_content(prompt, generation_config=config)
    return resp.text


async def _gemini_vision_text(image_bytes: bytes, ext: str, model_name: str) -> str:
    mime = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "webp": "image/webp", "gif": "image/gif"}.get(ext, "image/png")
    b64 = base64.b64encode(image_bytes).decode()

    def _call():
        model = genai.GenerativeModel(model_name=model_name, safety_settings=_SAFETY)
        resp = model.generate_content([
            {"mime_type": mime, "data": b64},
            (
                "You are analysing a brand logo or visual asset. "
                "Describe: (1) any text/company name visible, (2) exact colors used as hex codes, "
                "(3) the visual style and mood, (4) any design characteristics that suggest the brand personality. "
                "Be specific and concise."
            ),
        ])
        return resp.text

    try:
        return await asyncio.to_thread(_call)
    except Exception:
        return ""


# ── JSON helpers ──────────────────────────────────────────────────────────────

def _clean_json(s: str) -> str:
    s = re.sub(r"```(?:json)?", "", s).strip().rstrip("`").strip()
    start, end = s.find("{"), s.rfind("}") + 1
    return s[start:end] if start != -1 else s


# ── Color helpers ─────────────────────────────────────────────────────────────

def _hex_to_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _color_distance(a: tuple, b: tuple) -> float:
    return ((a[0]-b[0])**2 + (a[1]-b[1])**2 + (a[2]-b[2])**2) ** 0.5


def _is_near_white(h: str) -> bool:
    r, g, b = _hex_to_rgb(h)
    return r > 230 and g > 230 and b > 230


def _is_near_black(h: str) -> bool:
    r, g, b = _hex_to_rgb(h)
    return r < 25 and g < 25 and b < 25


def _dedupe_colors(colors: list[str]) -> list[str]:
    seen: list[str] = []
    for c in colors:
        try:
            rgb = _hex_to_rgb(c)
        except Exception:
            continue
        if not any(_color_distance(rgb, _hex_to_rgb(s)) < 30 for s in seen):
            seen.append(c)
    return seen


# ── Main entry point ──────────────────────────────────────────────────────────

async def extract_brand(
    file_bytes: bytes,
    filename: str,
    model_name: str = "gemini-2.0-flash",
) -> BrandContext:
    """
    Parse a PDF or image and return a rich BrandContext.
    """
    ext = filename.rsplit(".", 1)[-1].lower()
    text = ""
    mined_colors: list[str] = []

    if ext == "pdf":
        text         = _extract_pdf_text(file_bytes)
        mined_colors = _dedupe_colors(
            _mine_hex_colors(text) + _mine_rgb_colors(text)
        )
    elif ext in ("png", "jpg", "jpeg", "webp", "gif"):
        pixel_colors = _extract_image_colors(file_bytes)
        vision_text  = await _gemini_vision_text(file_bytes, ext, model_name)
        text         = vision_text
        mined_colors = _dedupe_colors(
            pixel_colors + _mine_hex_colors(vision_text)
        )
    else:
        raise ValueError(f"Unsupported file type .{ext}. Upload a PDF, PNG, or JPG.")

    if not text.strip() and not mined_colors:
        raise ValueError("Could not extract any content from the file.")

    # Deep Gemini analysis
    llm_raw = await asyncio.to_thread(
        _call_gemini,
        BRAND_EXTRACT_PROMPT.format(text=text[:10000] or "(image — no readable text)"),
        model_name,
    )

    try:
        data: dict = json.loads(_clean_json(llm_raw))
    except Exception:
        data = {}

    # Parse colors from LLM output (list of {hex, role, name} objects or bare strings)
    llm_color_list: list[str] = []
    color_roles:    dict[str, str] = {}
    for item in data.get("colors", []):
        if isinstance(item, dict):
            h = item.get("hex", "").strip().lower()
            if re.match(r'^#[0-9a-f]{6}$', h):
                llm_color_list.append(h)
                if item.get("role"):
                    color_roles[h] = item["role"]
        elif isinstance(item, str) and re.match(r'^#[0-9a-f]{3,6}$', item.strip()):
            llm_color_list.append(item.strip().lower())

    # Mined colors take priority (direct from doc); LLM fills in the rest
    merged_colors = _dedupe_colors(mined_colors + llm_color_list)[:8]

    # Parse fonts
    fonts: list[str] = []
    for item in data.get("fonts", []):
        name = (item.get("name") if isinstance(item, dict) else str(item)).strip()
        if name:
            fonts.append(name)

    return BrandContext(
        company_name    = data.get("company_name", ""),
        tagline         = data.get("tagline", ""),
        mission         = data.get("mission", ""),
        tone            = data.get("tone", ""),
        target_audience = data.get("target_audience", ""),
        ui_style        = data.get("ui_style", ""),
        colors          = merged_colors,
        color_roles     = color_roles,
        fonts           = fonts[:4],
        keywords        = [str(k) for k in data.get("keywords", [])][:8],
        design_rules    = [str(r) for r in data.get("design_rules", [])][:8],
        raw_excerpt     = text[:500].replace("\n", " ").strip(),
    )
