#!/bin/bash
set -e
echo "::group::Installing Unity Hub..."
baseUrl="https://public-cdn.cloud.unity3d.com/hub/prod"
cpuArch=$(uname -m)
if [ "$cpuArch" == "arm64" ]; then
    cpuArch="arm64"
else
    cpuArch="x64"
fi
fileName="UnityHubSetup"
url="$baseUrl/$fileName-$cpuArch.dmg"
downloadPath="$RUNNER_TEMP/$fileName-$cpuArch.dmg"
echo "Downloading Unity Hub from $url to $downloadPath..."
wget -qO "$downloadPath" "$url"
if [ ! -f "$downloadPath" ]; then
    echo "Failed to download Unity Hub"
    exit 1
fi
volume=$(hdiutil attach "$downloadPath" -nobrowse | grep -o "/Volumes/.*" | head -n1)
if [ -z "$volume" ]; then
    echo "Failed to mount $downloadPath"
    exit 1
fi
appPath=$(find "$volume" -name "*.app" | head -n1)
if [ -z "$appPath" ]; then
    echo "Failed to find Unity Hub app in $volume"
    exit 1
fi
cp -vrf "$appPath" /Applications
hdiutil unmount "$volume" -quiet
sudo chmod -R 777 /Applications/Unity\ Hub.app/Contents/MacOS/Unity\ Hub
sudo mkdir -p /Library/Application\ Support/Unity
sudo chmod -R 777 /Library/Application\ Support/Unity
echo "::endgroup::"
