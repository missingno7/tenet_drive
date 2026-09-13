@echo off
setlocal
cd /d "%~dp0"
set "TENET_NODE=node"
where node >nul 2>nul
if errorlevel 1 (
  set "TENET_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
)
"%TENET_NODE%" --version >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or later is required. Install it, then try again.
  pause
  exit /b 1
)
if not exist "node_modules\three\build\three.module.js" (
  echo Install dependencies first: npm install
  pause
  exit /b 1
)
if not exist "node_modules\@dimforge\rapier3d-compat\rapier.es.js" (
  echo Install dependencies first: npm install
  pause
  exit /b 1
)
"%TENET_NODE%" scripts\launch.mjs
pause
