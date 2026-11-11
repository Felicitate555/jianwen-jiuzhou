@echo off
chcp 65001 >nul
title 《剑问九州》本地游戏服务器
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-game.ps1"
if errorlevel 1 pause
