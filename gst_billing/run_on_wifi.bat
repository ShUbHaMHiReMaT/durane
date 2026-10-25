@echo off
rem Starts GST Billing so phones and tablets on the same Wi-Fi can open it.
rem Anyone on this Wi-Fi network can open the app, so use it only on your own office/home network.
cd /d "%~dp0"
set BILLING_HOST=0.0.0.0
set BILLING_OPEN=1
python app.py
pause
