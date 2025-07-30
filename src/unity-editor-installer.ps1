# This script is used to download and install older unity versions.
# https://discussions.unity.com/t/early-unity-versions-downloads/927331
# input arguments:
# 1. Unity Editor Version (Required)
# 2. Install Directory (Required)
# url example: https://beta.unity3d.com/download/UnitySetup-4.7.2.exe
$version = $args[0]
$installDir = $args[1]
if (-not $version) {
    Write-Host "Error: Unity version is required."
    exit 1
}
if (-not $installDir) {
    Write-Host "Error: Install directory is required."
    exit 1
}
Write-Host "::group::Installing Unity $version..."
$installerUrl = "https://beta.unity3d.com/download/UnitySetup-$version.exe"
$installerPath = "$env:TEMP\UnitySetup-$version.exe"
$wc = New-Object System.Net.WebClient
Write-Host "Downloading `"$installerUrl`" to `"$installerPath`"..."
$wc.DownloadFile($installerUrl, $installerPath)
if (-not (Test-Path $installerPath)) {
    Write-Host "Error: Failed to download Unity installer."
    exit 1
}
$targetPath = "$installDir\Unity $version"
Write-Host "[command]Start-Process `"$installerPath`" -ArgumentList `"/S /D=$targetPath`" -Wait -NoNewWindow"
if (-not (Test-Path "$targetPath")) {
    New-Item -ItemType Directory -Path "$targetPath" -Force | Out-Null
}
try {
    Start-Process -FilePath "$installerPath" -ArgumentList "/S /D=$targetPath" -Wait -NoNewWindow
    if (-not (Test-Path "$targetPath")) {
        Write-Host "Error: Unity installation failed."
        exit 1
    }
    Write-Host "Listing installed files in $targetPath"
    Get-ChildItem -Path "$targetPath" -Recurse | ForEach-Object {
        Write-Host $_.FullName
    }
}
catch {
    Write-Host "Error: Failed to start Unity installer."
    exit 1
}
finally {
    Remove-Item -Path "$installerPath" -Force
    Write-Host "::endgroup::"
}
