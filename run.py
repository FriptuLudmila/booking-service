#!/usr/bin/env python3
"""
Usage (Windows PowerShell):
  python run.py                # start on port 3001
  python run.py --dev          # dev mode with auto-reload
"""
import argparse, os, shutil, subprocess, sys

def exe(name: str) -> str:
    return name + ".cmd" if os.name == "nt" else name

def check_cmd(cmd: str) -> bool:
    return shutil.which(cmd) is not None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dev", action="store_true", help="Run in dev (auto-reload) mode")
    parser.add_argument("--port", type=int, default=3001, help="Port to listen on (default: 3001)")
    parser.add_argument("--force-install", action="store_true", help="Force npm install even if node_modules exists")
    args = parser.parse_args()

    if not check_cmd("node"):
        print("ERROR: Node.js not found in PATH. Install Node 18+ and try again.", file=sys.stderr)
        sys.exit(1)
    if not check_cmd(exe("npm")):
        print("ERROR: npm not found in PATH.", file=sys.stderr)
        sys.exit(1)

    need_install = args.force_install or not os.path.isdir("node_modules")
    if need_install:
        print("Installing dependencies (npm install)...")
        code = subprocess.call([exe("npm"), "install"])
        if code != 0:
            sys.exit(code)

    env = os.environ.copy()
    env["PORT"] = str(args.port)

    cmd = [exe("npm"), "run", "dev"] if args.dev else [exe("npm"), "start"]
    print(f"Starting Booking service on port {args.port} ({'dev' if args.dev else 'start'})...")
    try:
        proc = subprocess.Popen(cmd, env=env)
        proc.wait()
        sys.exit(proc.returncode)
    except KeyboardInterrupt:
        print("\nStopping...")
        try:
            proc.terminate()
        except Exception:
            pass

if __name__ == "__main__":
    main()
