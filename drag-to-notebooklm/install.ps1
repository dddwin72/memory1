# 드래그 → 구글 → NotebookLM 설치 스크립트 (Windows)
$ErrorActionPreference = "Stop"
$src  = Split-Path -Parent $MyInvocation.MyCommand.Path
$dest = Join-Path $env:LOCALAPPDATA "DragLearn"

Write-Host "1/4  파일 복사: $dest"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Recurse -Force (Join-Path $src "extension") $dest
Copy-Item -Recurse -Force (Join-Path $src "windows")   $dest

function Find-Ahk {
    $c = @(
        "$env:ProgramFiles\AutoHotkey\v2\AutoHotkey64.exe",
        "$env:LOCALAPPDATA\Programs\AutoHotkey\v2\AutoHotkey64.exe",
        "${env:ProgramFiles(x86)}\AutoHotkey\v2\AutoHotkey64.exe"
    )
    foreach ($p in $c) { if (Test-Path $p) { return $p } }
    return $null
}

Write-Host "2/4  AutoHotkey v2 확인"
$ahk = Find-Ahk
if (-not $ahk) {
    Write-Host "     AutoHotkey 가 없어 설치합니다 (winget)..."
    try { winget install --id AutoHotkey.AutoHotkey -e --silent --accept-package-agreements --accept-source-agreements } catch {}
    $ahk = Find-Ahk
}

$script = Join-Path $dest "windows\DragLearn.ahk"
if ($ahk) {
    Write-Host "3/4  Windows 시작 시 자동 실행 등록"
    $lnk = Join-Path ([Environment]::GetFolderPath("Startup")) "DragLearn.lnk"
    $sh = New-Object -ComObject WScript.Shell
    $s = $sh.CreateShortcut($lnk)
    $s.TargetPath = $ahk
    $s.Arguments = "`"$script`""
    $s.WorkingDirectory = Split-Path $script
    $s.Save()
    Start-Process $ahk -ArgumentList "`"$script`""
} else {
    Write-Warning "AutoHotkey v2 를 자동 설치하지 못했습니다. https://www.autohotkey.com 에서 v2 를 설치한 뒤 install.bat 을 다시 실행하세요. (브라우저 확장 프로그램은 그대로 사용할 수 있습니다)"
}

Write-Host "4/4  브라우저 확장 프로그램 등록 안내"
$ext = Join-Path $dest "extension"
Set-Clipboard -Value $ext
Start-Process explorer.exe $ext
try { Start-Process "chrome.exe" "chrome://extensions" } catch {}

Write-Host ""
Write-Host "거의 끝났습니다! 크롬 확장 프로그램 화면에서 딱 한 번만:"
Write-Host "  (1) 오른쪽 위 '개발자 모드' 켜기"
Write-Host "  (2) '압축해제된 확장 프로그램을 로드합니다' 클릭"
Write-Host "  (3) 폴더 주소 붙여넣기(Ctrl+V, 이미 복사됨) → 폴더 선택"
Write-Host "       $ext"
Write-Host ""
Read-Host "Enter 를 누르면 닫힙니다"
