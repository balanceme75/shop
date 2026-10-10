# =====================================================================
# 초록마트 로컬 미리보기 서버
#   사용법 :  powershell -ExecutionPolicy Bypass -File serve.ps1
#   주소   :  http://localhost:9000
#   종료   :  Ctrl + C
# (이 PC 에는 Python 이 설치되어 있지 않아 PowerShell 로 대체합니다)
# =====================================================================
param([int]$Port = 9000)

$root = $PSScriptRoot
$prefix = "http://localhost:$Port/"

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.ico'  = 'image/x-icon'
  '.md'   = 'text/markdown; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try {
  $listener.Start()
} catch {
  Write-Host "포트 $Port 를 열 수 없습니다: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "  초록마트 로컬 서버 실행 중" -ForegroundColor Green
Write-Host "  $prefix" -ForegroundColor Cyan
Write-Host "  폴더: $root"
Write-Host "  종료: Ctrl + C"
Write-Host ""

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response

    $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
    $path = Join-Path $root $rel

    # 폴더 밖 접근 차단 + .env 등 비공개 파일 차단
    $full = [System.IO.Path]::GetFullPath($path)
    $deny = ($full -notlike (Join-Path $root '*')) -or ($rel -like '.env*') -or ($rel -like '.git*')

    if ($deny -or -not (Test-Path -LiteralPath $full -PathType Leaf)) {
      $res.StatusCode = 404
      $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
      $res.ContentType = 'text/plain; charset=utf-8'
    } else {
      $res.StatusCode = 200
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-store')
      $body = [System.IO.File]::ReadAllBytes($full)
    }

    Write-Host ("  {0} {1} -> {2}" -f $req.HttpMethod, $rel, $res.StatusCode)
    $res.ContentLength64 = $body.Length
    $res.OutputStream.Write($body, 0, $body.Length)
    $res.OutputStream.Close()
  }
} finally {
  $listener.Stop()
  $listener.Close()
}
