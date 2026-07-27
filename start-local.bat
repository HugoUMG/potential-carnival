@echo off
cd /d "%~dp0"

if not exist .env (
  copy .env.example .env >nul
  echo Creado .env desde .env.example
)

if not exist node_modules (
  echo Instalando dependencias de frontend...
  call npm install
)

echo Instalando dependencias de backend...
pip install -r backend\requirements.txt

start "Backend" cmd /k "uvicorn backend.app.main:app --reload --port 8000"
start "Frontend" cmd /k "npm run dev"
