Write-Host "::group::Installing Unity Hub..."
$tempPath = "$env:RUNNER_TEMP\UnityHubSetup.exe"
$url = 'https://public-cdn.cloud.unity3d.com/hub/prod/UnityHubSetup.exe'
$wc = New-Object System.Net.WebClient
Write-Host "Downloading `"$url`" > `"$tempPath`"..."
$wc.DownloadFile($url, $tempPath)
if (-not (Test-Path $tempPath)) {
    Write-Host "Error: Failed to download Unity Hub installer."
    exit 1
}
Write-Host "[command]Start-Process -FilePath `"$tempPath`" -ArgumentList '/S' -Wait -NoNewWindow"
$process = Start-Process -FilePath "$tempPath" -ArgumentList '/S' -PassThru -Wait
Write-Host "::endgroup::"
exit [int]$process.ExitCode
