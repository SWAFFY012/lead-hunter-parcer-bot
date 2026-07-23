@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Сборка интерфейса LeadHunter...
call npm.cmd --prefix frontend run build
if errorlevel 1 (
  echo Не удалось собрать интерфейс.
  pause
  exit /b 1
)

echo Запуск сервера и сайта...
call npm.cmd run host:start
if errorlevel 1 (
  echo Не удалось запустить хост.
  pause
  exit /b 1
)

echo LeadHunter запущен: http://localhost:5173/parser
start "" "http://localhost:5173/parser"
