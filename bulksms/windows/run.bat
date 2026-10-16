@echo off
chcp 65001 >nul
title PayamResan Desktop
cd /d "%~dp0"
where python >nul 2>nul || (
  echo Python پیدا نشد. نسخهٔ سبز برنامه: PayamResan-Setup.exe را اجرا کنید.
  pause
  exit /b 1
)
python -m pip show PySide6 >nul 2>nul || (
  echo در حال نصب پیش‌نیاز...
  python -m pip install -r requirements.txt
)
python PayamResan.py
if errorlevel 1 pause
