@echo off
REM NEFT Outward tests: maker creates, approver approves/disapproves, then transmit
REM (Generate Presentment Files). "all" includes transmit, which sends ALL approved items.
REM
REM   run-neft.cmd                    all five (4 transfers, then transmit), browser visible
REM   run-neft.cmd cr-approve         just one: cr-approve | cr-disapprove | dr-approve | dr-disapprove | transmit
REM   run-neft.cmd all headless       add "headless" to hide the browser
cd /d "%~dp0"
set WHICH=%1
if "%WHICH%"=="" set WHICH=all
set TARGET=tests/neft-outward
if /i not "%WHICH%"=="all" set TARGET=tests/neft-outward/neft-outward-%WHICH%.spec.ts
set HEADED=--headed
if /i "%2"=="headless" set HEADED=
if /i "%1"=="headless" (set TARGET=tests/neft-outward& set HEADED=)

call npx.cmd playwright test %TARGET% %HEADED%
echo.
echo Opening the HTML report (Ctrl+C to stop it)...
call npx.cmd playwright show-report
