# Buildalon Unity Setup

[![Discord](https://img.shields.io/discord/939721153688264824.svg?label=&logo=discord&logoColor=ffffff&color=7389D8&labelColor=6A7EC2)](https://discord.gg/VM9cWJ9rjH) [![marketplace](https://img.shields.io/static/v1?label=&labelColor=505050&message=Buildalon%20Actions&color=FF1E6F&logo=github-actions&logoColor=0076D6)](https://github.com/marketplace?query=buildalon) [![actions](https://github.com/buildalon/unity-setup/actions/workflows/validate.yml/badge.svg?branch=main&event=push)](https://github.com/buildalon/unity-setup/actions/workflows/validate.yml)

A GitHub Action for setting up the [Unity Game Engine](https://unity.com) for CI/CD workflows.

## How to use

### workflow

```yaml
strategy:
  matrix:
    os: [ubuntu-latest, windows-latest, macos-latest]
    unity-version:
      - None
      - 2019.4.40f1 (ffc62b691db5)
      - 2020.x
      - 2021.3.x
      - 2022.3
      - 6000.0.x
      - 6000.1.*
      - 6000
    include:
      - os: ubuntu-latest
        build-targets: StandaloneLinux64, Android, iOS
        modules: linux-server
      - os: windows-latest
        build-targets: StandaloneWindows64, Android, WSAPlayer
        modules: windows-server
      - os: macos-latest
        build-targets: StandaloneOSX, Android, iOS, VisionOS
        modules: mac-server
steps:
  - uses: buildalon/unity-setup@v1
    with:
      version-file: 'path/to/your/unity/project/ProjectSettings/ProjectVersion.txt'
      unity-version: ${{ matrix.unity-version }} # overrides version in version-file
      build-targets: ${{ matrix.build-targets }}
      modules: ${{ matrix.modules }}

  - run: |
      echo "UNITY_HUB_PATH: '${{ env.UNITY_HUB_PATH }}'"
      echo "UNITY_EDITORS: '${{ env.UNITY_EDITORS }}'"
      echo "UNITY_EDITOR_PATH: '${{ env.UNITY_EDITOR_PATH }}'"
      echo "UNITY_PROJECT_PATH: '${{ env.UNITY_PROJECT_PATH }}'"
```

### inputs

| name | description | required |
| ----------- | ----------- | ----------- |
| `version-file` | Specify a path to search for the unity project version text file. Useful if there are multiple projects in a single repo. Pass `None` if creating a new project to skip file search. | false |
| `unity-version` | Specify the Unity version(s) to install. example: `2019.4.13f1 (518737b1de84)`. ***This will override any version specified in the `version-file`!*** | false |
| `build-targets` | Specify the build targets to install for. Remaps to corresponding module. One or more of `StandaloneWindows64` `WSAPlayer` `StandaloneOSX` `iOS` `StandaloneLinux64` `Android` `Lumin` `WebGL` `VisionOS`. | false |
| `modules` | Modules to install with the editor. This list can be different per editor version. | false |
| `architecture` | Specify the architecture to install. Either `x86_64` or `arm64`. | false |
| `install-path` | Specify the path where Unity will be installed to. | false |
| `auto-update-hub` | Automatically update Unity Hub to the latest version before installing Unity Editors. Can be `true` or `false`. Default is `true`. | false || false |
| `install-path` | Specify the path where Unity will be installed to. | false |

#### unity-version formats

Use any of the following patterns to control how the editor version is resolved:

- Fully qualified: `2022.3.62f1` or `2019.4.40f1 (ffc62b691db5)`
- Major + minor: `6000.2` → latest stable in the 6000.2.x line
- Major only: `6000` or `2022` → latest stable in that major (e.g., `6000.2.1f1`, `2022.3.x`)
- Wildcards: `2021.3.x`, `2022.3.*`, `6000.0.x`
- Exact year+minor with trailing zero: `6000.0.0` confines selection to the 6000.0.x line

Notes:

- If you want the latest across minors within a major, use just the major (e.g., `6000`).
- If you want to stay within a specific minor, use `MAJOR.MINOR` (e.g., `6000.2`).
- If you want to lock to the `.0` minor, use `6000.0.0` or `6000.0.x`.
- Stable (f) releases are preferred unless you explicitly specify a pre-release (a/b/rc) version.

### outputs

- `UNITY_HUB_PATH`: The path to the installed unity hub.
- `UNITY_PROJECT_PATH`: The path to the Unity project.
- `UNITY_EDITOR_PATH`: The path to the last installed version of Unity.
- `UNITY_EDITORS`: A json object array of each editor installation `[{"version":"path"},...]`.
