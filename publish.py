#!/usr/bin/env python3
"""
OsyC 插件发布脚本：build -> commit -> push -> 更新 GitHub Release 附件。

用法（在项目根目录 C:/Users/Y2516/WorkBuddy/2026-08-29-19-16-25 下）：
    PYTHONPATH=... python outputs/github-repo/publish.py "提交说明"

环境变量（必填）：
    OSYC_GITHUB_TOKEN : GitHub Personal Access Token（需 repo 权限）

前置条件：
- dev/obsidian-livesync/ 有可 build 的插件源码（Node 24+）
- outputs/github-repo/ 是 git 仓库，remote 指向 git@github.com:3yesore/OsyC.git
- SSH key ~/.ssh/github_osyc 已配置并加到 GitHub

流程：
1. bump manifest.json 版本号（patch +1），并同步 package.json 与 versions.json（单一真相源）
2. 同步到 dev 目录并在那里 build
3. 把产物 main.js/manifest.json/styles.css/versions.json 复制回 outputs/github-repo/
4. git commit + push
5. 用 GitHub API 删除旧 Release 附件 + 上传新附件（无需手动建 Release）

BRAT 行为：用户打开 Obsidian 时自动检查并下载最新 Release，无需手动操作。
"""
import json
import os
import re
import subprocess
import sys
import urllib.request
import ssl
from pathlib import Path

# ---------- 路径 ----------
ROOT = Path(r"C:/Users/Y2516/WorkBuddy/2026-08-29-19-16-25")
DEV = ROOT / "dev" / "obsidian-livesync"
REPO = ROOT / "outputs" / "github-repo"
REPO_FULL = "3yesore/OsyC"

TOKEN = os.environ.get("OSYC_GITHUB_TOKEN", "")
if not TOKEN:
    print("ERROR: 请设置环境变量 OSYC_GITHUB_TOKEN")
    sys.exit(1)

NODE = r"C:/Program Files/nodejs"
PYTHON = r"C:/Users/Y2516/.workbuddy/binaries/python/versions/3.13.12/python.exe"

commit_msg = sys.argv[1] if len(sys.argv) > 1 else "插件更新"


def bump_version(manifest_path: Path) -> str:
    """manifest.json 版本号 patch +1，并同步 package.json 与 versions.json。

    单一真相源：三个文件必须一致，避免「manifest 已 1.0.27、package 还 1.0.21」式的混乱。
    """
    data = json.loads(manifest_path.read_text(encoding="utf-8"))
    old = data["version"]
    m = re.match(r"(\d+)\.(\d+)\.(\d+)", old)
    major, minor, patch = int(m[1]), int(m[2]), int(m[3]) + 1
    new = f"{major}.{minor}.{patch}"
    min_app = data.get("minAppVersion", "1.7.2")

    # 1) manifest.json
    data["version"] = new
    manifest_path.write_text(json.dumps(data, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")

    # 2) package.json（与 manifest 同值）
    pkg_path = manifest_path.parent / "package.json"
    if pkg_path.exists():
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        pkg["version"] = new
        pkg_path.write_text(json.dumps(pkg, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")

    # 3) versions.json（每个发布版本登记到 minAppVersion）
    ver_path = manifest_path.parent / "versions.json"
    versions = json.loads(ver_path.read_text(encoding="utf-8")) if ver_path.exists() else {}
    versions[new] = min_app
    ver_path.write_text(json.dumps(versions, indent=4, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"版本号: {old} -> {new}（manifest / package / versions 已同步）")
    return new


def build_plugin():
    """在 dev 目录跑 npm run build。"""
    env = os.environ.copy()
    env["PATH"] = NODE + os.pathsep + env.get("PATH", "")
    print("正在 build...")
    # Windows 上 npm 是 .cmd 脚本，必须 shell=True 才能找到
    use_shell = os.name == "nt"
    r = subprocess.run(["npm", "run", "build"], cwd=str(DEV), env=env,
                       capture_output=True, text=True, timeout=180, shell=use_shell)
    if r.returncode != 0:
        print("BUILD 失败:", r.stderr or r.stdout)
        sys.exit(1)
    print("build 完成")


def copy_artifacts():
    """把 build 产物复制到 github-repo（含 versions.json）。"""
    for name in ["main.js", "manifest.json", "manifest-beta.json", "styles.css", "versions.json"]:
        src, dst = DEV / name, REPO / name
        dst.write_bytes(src.read_bytes())
    print("产物已复制")


def git_commit_push(msg: str):
    """提交并推送到远端 main。"""
    subprocess.run(["git", "add", "main.js", "manifest.json", "manifest-beta.json", "styles.css", "versions.json"], cwd=str(REPO), check=True)
    subprocess.run(["git", "commit", "-m", msg], cwd=str(REPO), check=True)
    r = subprocess.run(["git", "push", "origin", "main"], cwd=str(REPO),
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("PUSH 失败:", r.stderr)
        sys.exit(1)
    print("已推送:", r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "ok")


def update_release():
    """用 GitHub API 更新 Release 的三个附件。"""
    ctx = ssl.create_default_context()
    headers = {"Authorization": f"Bearer {TOKEN}", "User-Agent": "OsyC-publish",
               "Accept": "application/vnd.github+json"}

    # 找现有 release（取第一个）
    req = urllib.request.Request(f"https://api.github.com/repos/{REPO_FULL}/releases",
                                 headers=headers)
    with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
        rels = json.loads(r.read())
    if not rels:
        print("警告：仓库没有 Release，请先手动建一个（tag 随意，如 OsyC）。脚本只负责更新附件。")
        sys.exit(1)
    rel = rels[0]
    print(f"目标 Release: {rel.get('name')} | tag: {rel.get('tag_name')} | id: {rel['id']}")

    # 删旧附件
    for asset in rel.get("assets", []):
        req = urllib.request.Request(
            f"https://api.github.com/repos/{REPO_FULL}/releases/assets/{asset['id']}",
            method="DELETE", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=15, context=ctx) as r:
                print(f"  删除旧附件: {asset['name']} -> {r.status}")
        except Exception as e:
            print(f"  删除失败: {asset['name']} {e}")

    # 上传新附件
    upload_base = rel["upload_url"].split("{")[0]
    mime = {"main.js": "application/javascript",
            "manifest.json": "application/json",
            "manifest-beta.json": "application/json",
            "styles.css": "text/css",
            "versions.json": "application/json"}
    for fname in ["main.js", "manifest.json", "manifest-beta.json", "styles.css", "versions.json"]:
        data = (REPO / fname).read_bytes()
        url = f"{upload_base}?name={fname}&label={fname}"
        req = urllib.request.Request(url, data=data, method="POST",
                                     headers={**headers, "Content-Type": mime[fname]})
        try:
            with urllib.request.urlopen(req, timeout=60, context=ctx) as r:
                print(f"  上传新附件: {fname} -> {r.status} | {len(data)} bytes")
        except Exception as e:
            print(f"  上传失败: {fname} {e}")
    print("Release 更新完成")


if __name__ == "__main__":
    version = bump_version(DEV / "manifest.json")
    build_plugin()
    copy_artifacts()
    git_commit_push(f"{commit_msg} (v{version})")
    update_release()
    print(f"\n=== 发布完成 v{version} ===")
    print("用户下次打开 Obsidian 时，BRAT 会自动拉取此版本。")
