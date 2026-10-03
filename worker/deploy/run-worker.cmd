@echo off
rem Starts the VayuNetra worker from Windows Task Scheduler and appends its output to logs\worker.log.
cd /d "%~dp0\.."
if not exist logs mkdir logs
".venv\Scripts\vayu.exe" worker --health-port 8787 >> logs\worker.log 2>&1
