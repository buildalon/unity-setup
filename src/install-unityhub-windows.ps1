Write-Host "::group::Installing Unity Hub..."
$tempPath = "$env:RUNNER_TEMP/UnityHubSetup.exe"
$url = 'https://public-cdn.cloud.unity3d.com/hub/prod/UnityHubSetup.exe'
$wc = New-Object System.Net.WebClient
Write-Host "Downloading `"$url`" > `"$tempPath`"..."
$wc.DownloadFile($url, $tempPath)
Write-Host "`"$tempPath`" /S"
$process = Start-Process -FilePath $tempPath -ArgumentList '/S' -PassThru -Wait
Write-Host "::endgroup::"
exit [int]$process.ExitCode
