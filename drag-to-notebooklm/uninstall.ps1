# 제거: 자동 실행 해제 + 설치 폴더 삭제 (확장 프로그램은 chrome://extensions 에서 '삭제')
Get-CimInstance Win32_Process -Filter "Name like 'AutoHotkey%'" | Where-Object { $_.CommandLine -like "*DragLearn.ahk*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path ([Environment]::GetFolderPath("Startup")) "DragLearn.lnk")
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue (Join-Path $env:LOCALAPPDATA "DragLearn")
Write-Host "제거되었습니다."
