#!/usr/bin/env python3
"""PreToolUse gate: scan a skill with SkillSpector before it is installed.

Blocks (exit 2) when a skill is written, copied or moved into a `skills/`
directory and `skillspector scan` reports it as unsafe, and blocks remote
installs (git clone / curl / unzip / plugin install straight into a skills
dir) until the skill has been staged elsewhere and scanned.

Env:
  SKILLSPECTOR_HOOK_LLM=1   also run LLM analysis (needs provider credentials)
"""
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

SKILLS_RE = re.compile(r"(^|/)(skills|\.claude/skills|\.claude/plugins)(/|$)")
REMOTE_INSTALL_RE = re.compile(
    r"\b(claude\s+plugin\s+(install|add)|/plugin\s+install|npx\s+[\w@/.-]*skills?\s+(add|install))\b"
)


def deny(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(2)


def ensure_skillspector() -> str:
    exe = shutil.which("skillspector") or os.path.expanduser("~/.local/bin/skillspector")
    if os.path.exists(exe):
        return exe
    uv = shutil.which("uv") or os.path.expanduser("~/.local/bin/uv")
    if os.path.exists(uv):
        subprocess.run(
            [uv, "tool", "install", "--python", "3.13",
             "skillspector[mcp] @ git+https://github.com/NVIDIA/skillspector.git"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=600,
        )
    exe = shutil.which("skillspector") or os.path.expanduser("~/.local/bin/skillspector")
    if not os.path.exists(exe):
        deny("[skill-scan-gate] skillspector is not installed and auto-install failed. "
             "Install it first: uv tool install --python 3.13 git+https://github.com/NVIDIA/skillspector.git")
    return exe


def scan(path: str, label: str) -> None:
    """Scan `path`; deny the tool call if it is not safe."""
    exe = ensure_skillspector()
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, "report.json")
        cmd = [exe, "scan", path, "--format", "json", "--output", out]
        if os.environ.get("SKILLSPECTOR_HOOK_LLM") != "1":
            cmd.append("--no-llm")
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        report = {}
        try:
            with open(out) as f:
                report = json.load(f)
        except Exception:
            pass
    risk = report.get("risk_assessment", {})
    if proc.returncode == 0 and risk.get("recommendation", "SAFE") != "DO_NOT_INSTALL":
        print(f"[skill-scan-gate] {label}: SkillSpector passed "
              f"(score {risk.get('score', '?')}, {risk.get('recommendation', 'SAFE')})", file=sys.stderr)
        return
    lines = [f"[skill-scan-gate] BLOCKED: SkillSpector flagged {label}",
             f"  risk: score={risk.get('score', '?')} severity={risk.get('severity', '?')} "
             f"recommendation={risk.get('recommendation', '?')} (exit {proc.returncode})"]
    for issue in (report.get("issues") or [])[:8]:
        loc = issue.get("location")
        if isinstance(loc, dict):
            loc = f"{loc.get('file', '')}:{loc.get('line', '')}"
        lines.append(f"  - [{issue.get('severity')}] {issue.get('category', '')}: "
                     f"{str(issue.get('finding') or issue.get('explanation') or '')[:160]} ({loc})")
    if not report:
        lines.append((proc.stderr or proc.stdout or "").strip()[-1500:])
    lines.append("Do not install this skill. Show these findings to the user and let them decide.")
    deny("\n".join(lines))


def skill_root(file_path: str) -> str:
    """.../skills/<name>/anything -> .../skills/<name>"""
    parts = os.path.abspath(file_path).split(os.sep)
    for i in range(len(parts) - 1, -1, -1):
        if parts[i] == "skills" and i + 1 < len(parts) - 1:
            return os.sep.join(parts[: i + 2])
    return os.path.dirname(os.path.abspath(file_path))


def handle_file_tool(tool: str, ti: dict) -> None:
    fp = ti.get("file_path") or ti.get("notebook_path") or ""
    if not fp or not SKILLS_RE.search(os.path.abspath(fp)):
        return
    root = skill_root(fp)
    rel = os.path.relpath(os.path.abspath(fp), root)
    with tempfile.TemporaryDirectory() as tmp:
        stage = os.path.join(tmp, os.path.basename(root) or "skill")
        if os.path.isdir(root):
            shutil.copytree(root, stage, symlinks=True)
        else:
            os.makedirs(stage)
        target = os.path.join(stage, rel)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        if tool == "Write":
            with open(target, "w") as f:
                f.write(ti.get("content", ""))
        elif tool in ("Edit", "MultiEdit"):
            text = open(target).read() if os.path.exists(target) else ""
            edits = ti.get("edits") or [ti]
            for e in edits:
                old, new = e.get("old_string", ""), e.get("new_string", "")
                text = text.replace(old, new) if e.get("replace_all") else text.replace(old, new, 1)
            with open(target, "w") as f:
                f.write(text)
        if not os.path.exists(os.path.join(stage, "SKILL.md")):
            return  # no SKILL.md yet; the whole dir is scanned when SKILL.md is written
        scan(stage, f"skill '{os.path.basename(root)}' ({tool} {rel})")


def split_segments(cmd: str):
    for seg in re.split(r"&&|\|\||;|\||\n", cmd):
        try:
            toks = shlex.split(seg)
        except ValueError:
            toks = seg.split()
        while toks and re.match(r"^\w+=", toks[0]):
            toks = toks[1:]
        if toks and toks[0] in ("sudo", "command", "exec"):
            toks = toks[1:]
        if toks:
            yield toks


def handle_bash(cmd: str) -> None:
    if REMOTE_INSTALL_RE.search(cmd):
        deny("[skill-scan-gate] BLOCKED: install the skill/plugin only after a SkillSpector scan. "
             "Download or clone it to a staging dir outside any skills/ folder, run "
             "`skillspector scan <dir> --no-llm`, report the result to the user, then install.")
    for toks in split_segments(cmd):
        prog = os.path.basename(toks[0])
        args = [t for t in toks[1:] if not t.startswith("-")]
        dest_hits = [a for a in args if SKILLS_RE.search(os.path.abspath(os.path.expanduser(a)))]
        if prog in ("cp", "mv", "rsync", "ln", "install") and len(args) >= 2:
            dest = args[-1]
            if not SKILLS_RE.search(os.path.abspath(os.path.expanduser(dest))):
                continue
            for src in args[:-1]:
                src = os.path.expanduser(src.rstrip("/"))
                if os.path.isdir(src):
                    scan(src, f"'{src}' -> {dest}")
                elif os.path.isfile(src) and src.lower().endswith(".zip"):
                    scan(src, f"'{src}' -> {dest}")
                elif os.path.isfile(src):
                    with tempfile.TemporaryDirectory() as tmp:
                        d = os.path.join(tmp, "skill")
                        dest_abs = os.path.abspath(os.path.expanduser(dest))
                        root = skill_root(os.path.join(dest_abs, os.path.basename(src))
                                          if os.path.isdir(dest_abs) else dest_abs)
                        if os.path.isdir(root):
                            shutil.copytree(root, d, symlinks=True)
                        else:
                            os.makedirs(d)
                        shutil.copy(src, os.path.join(d, os.path.basename(src)))
                        if os.path.exists(os.path.join(d, "SKILL.md")):
                            scan(d, f"'{src}' -> {dest}")
        elif prog == "git" and not (len(toks) > 1 and toks[1] in ("clone", "submodule", "subtree")):
            continue
        elif prog == "gh" and not (len(toks) > 2 and toks[1:3] == ["repo", "clone"]):
            continue
        elif dest_hits and prog in ("git", "curl", "wget", "unzip", "tar", "gh", "npx", "bunx", "pnpm") \
                and (prog in ("git", "gh") or any("/" in a for a in dest_hits)):
            deny(f"[skill-scan-gate] BLOCKED: `{prog}` writes straight into {dest_hits[0]}. "
                 "Fetch/extract the skill to a staging dir outside any skills/ folder first, run "
                 "`skillspector scan <dir> --no-llm`, show the result to the user, then cp it in "
                 "(the cp is scanned again by this hook).")


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return
    tool = data.get("tool_name", "")
    ti = data.get("tool_input") or {}
    if tool in ("Write", "Edit", "MultiEdit"):
        handle_file_tool(tool, ti)
    elif tool == "Bash":
        handle_bash(ti.get("command", ""))


if __name__ == "__main__":
    main()
