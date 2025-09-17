#!/bin/bash
set -e
sudo sh -c 'dbus-uuidgen >/etc/machine-id && mkdir -p /var/lib/dbus/ && ln -sf /etc/machine-id /var/lib/dbus/machine-id'
echo "::group::Installing Unity Hub..."
wget -qO - https://hub.unity3d.com/linux/keys/public | gpg --dearmor | sudo tee /usr/share/keyrings/Unity_Technologies_ApS.gpg >/dev/null
sudo sh -c 'echo "deb [signed-by=/usr/share/keyrings/Unity_Technologies_ApS.gpg] https://hub.unity3d.com/linux/repos/deb stable main" > /etc/apt/sources.list.d/unityhub.list'
echo "deb https://archive.ubuntu.com/ubuntu jammy main universe" | sudo tee /etc/apt/sources.list.d/jammy.list
sudo apt-get update
sudo apt-get install -y --no-install-recommends unityhub ffmpeg libgtk2.0-0 libglu1-mesa libgconf-2-4 libncurses5
sudo apt-get clean

sudo sed -i 's/^\(.*DISPLAY=:.*XAUTHORITY=.*\)\( "\$@" \)2>&1$/\1\2/' /usr/bin/xvfb-run
sudo printf '#!/bin/bash\nxvfb-run --auto-servernum /opt/unityhub/unityhub "$@" 2>/dev/null' | sudo tee /usr/bin/unity-hub >/dev/null
sudo chmod 777 /usr/bin/unity-hub
hubPath=$(which unityhub)

if [ -z "$hubPath" ]; then
    echo "Failed to install Unity Hub"
    exit 1
fi

sudo chmod -R 777 "$hubPath"
echo "UNITY_HUB /opt/unityhub/unityhub"
echo "::endgroup::"
