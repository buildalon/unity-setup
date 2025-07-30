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
downloadPath="${RUNNER_TEMP}/$fileName-$cpuArch.dmg"
echo "Downloading Unity Hub from $url to $downloadPath..."
wget -qO "${downloadPath}" "${url}"
if [ ! -f "${downloadPath}" ]; then
    echo "Failed to download Unity Hub"
    exit 1
fi
volumes=$(hdiutil attach "${downloadPath}" -nobrowse | grep -o "/Volumes/.*" | head -n1)
if [ -z "${volumes}" ]; then
    echo "Failed to mount ${downloadPath}"
    exit 1
fi
echo "Mounted volumes:"
echo "${volumes}"
# can be "/Volumes/Unity Hub 3.13.1-arm64" or "/Volumes/Unity Hub 3.13.1"
volume=$(echo "${volumes}" | grep -o "/Volumes/Unity Hub.*" | head -n1)
if [ -z "${volume}" ]; then
    hdiutil unmount "${volumes}" -quiet
    echo "Failed to find Unity Hub volume in ${volumes}"
    exit 1
fi
appPath=$(find "${volume}" -name "*.app" | head -n1)
echo "moving ${appPath} to /Applications..."
if [ -z "${appPath}" ]; then
    echo "Failed to find Unity Hub app in ${volume}"
    hdiutil unmount "${volume}" -quiet
    exit 1
fi
cp -vrf "${appPath}" /Applications
hdiutil unmount "${volume}" -quiet
sudo chmod -R 777 /Applications/Unity\ Hub.app/Contents/MacOS/Unity\ Hub
sudo mkdir -p /Library/Application\ Support/Unity
sudo chmod -R 777 /Library/Application\ Support/Unity
echo "::endgroup::"
