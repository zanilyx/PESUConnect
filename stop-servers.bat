@echo off
echo Stopping PESUConnect servers...
echo.

echo Checking for processes on port 5000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000" ^| findstr "LISTENING"') do (
    echo Killing process %%a on port 5000...
    taskkill /F /PID %%a >nul 2>&1
)

echo Checking for processes on port 3000...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Killing process %%a on port 3000...
    taskkill /F /PID %%a >nul 2>&1
)

echo.
echo Done! Ports should be free now.
pause

