@echo off
chcp 65001 >nul
cd /d %~dp0
python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
