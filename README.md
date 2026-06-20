# PLAY.PARSE.ANALYZE.REPEAT<br/>Fortnite.Replay.Decompressor

<b>Standalone .NET Replay Parser And Analyzer For Fortnite Replays (*.replay)</b>

This project was originally forked from [Shiqan/FortniteReplayDecompressor](https://github.com/Shiqan/FortniteReplayDecompressor). The original parser and replay model code still come from that codebase. On top of it, this fork adds a text/JSON export pipeline and console tooling that writes analysis artifacts for each replay.

## What this fork adds

- JSON export for each parsed replay
- Human-readable TXT analysis output
- Owner and ranking analysis
- Kill feed summary and replay stats
- Default output written to `REPLAYS/PARSED`
- Optional long-running replay watcher (`ReplayWatcher`) for automatic parsing after a match finishes
- **New:** React Web Dashboard (`ReplayDashboard.Client`) for a beautiful, real-time browser UI

Screenshot:

![Replay watcher console output](Screenshot.png)

## How it works

The project is split into several key components that work together to process and analyze Fortnite replays:

1. **FortniteReplayReader**: The core parsing engine that reads raw `*.replay` binary files (which use the Unreal Engine replay format) and deserializes them into a structured C# object model. It handles decompression, reading network packets, and extracting game events.
2. **ReplayAnalyzer**: A robust extraction layer that takes the raw object model and processes it into meaningful statistics. It searches the replay for the recording player ("owner"), determines their final match placement, aggregates the team's total eliminations, and reconstructs the timeline of the kill feed. It outputs this data as both a comprehensive JSON file and a human-readable summary TXT file.
3. **ReplayWatcher**: A standalone background worker designed to run silently. It uses file system watchers to monitor your Fortnite replay directory (`%LOCALAPPDATA%\FortniteGame\Saved\Demos`) for new or modified `*.replay` files. Once a match concludes and the file becomes stable (fully written by the game), the watcher automatically triggers the `ReplayAnalyzer` and drops the parsed results into a designated output folder, alerting you in the console.
4. **ConsoleReader**: A command-line tool for manually bulk-processing existing replay files or entire directories.
5. **ReplayDashboard.Client**: A Vite + React web application. When launched, it automatically boots up the `ReplayWatcher` in the background and serves a modern, glassmorphic UI in your browser that live-updates whenever a new replay is saved.

## Requirements

- .NET SDK 10.0 or newer
- Windows PowerShell or a terminal capable of running `dotnet`

If you need to install the SDK on Windows, the quickest path is:

```powershell
winget install --id Microsoft.DotNet.SDK.10 --exact
```

## Build

Run from repository root:

```powershell
dotnet restore
dotnet build -c Release
```

## Run on replays

Run from repository root.

Parse a single replay file:

```powershell
dotnet run --project .\src\ConsoleReader\ConsoleReader.csproj -c Release -- .\REPLAYS\YourReplay.replay
```

Parse a folder of replay files:

```powershell
dotnet run --project .\src\ConsoleReader\ConsoleReader.csproj -c Release -- .\REPLAYS
```

The exporter writes these files under `REPLAYS/PARSED` by default:

- `<replay-name>.json`
- `<replay-name>.txt`

Optional flags:

- `--quiet`: suppresses diagnostics in console output
- `--output-root <path>`: custom output directory

## Auto watch new replays (ReplayWatcher)

`ReplayWatcher` is a dedicated .NET console app that keeps running until you close it (or press `Ctrl+C`). It scans for new `*.replay` files, waits until files are stable, then writes both JSON and TXT and prints a summary to console.

Default watch directory:

- `%LOCALAPPDATA%\FortniteGame\Saved\Demos`

Run from repository root:

```powershell
dotnet run --project .\src\ReplayWatcher\ReplayWatcher.csproj -c Release
```

Common options:

- `--dir <path>`: custom replay directory
- `--output-subdir <name>`: subfolder inside watched replay directory (default: `PARSED`)
- `--scan-interval <seconds>`: polling interval in seconds (default: `2`)
- `--process-existing`: also process already existing replay files on startup

Examples:

```powershell
# Watch repository REPLAYS folder and write to REPLAYS\PARSED
dotnet run --project .\src\ReplayWatcher\ReplayWatcher.csproj -c Release -- --dir .\REPLAYS

# Process existing files too
dotnet run --project .\src\ReplayWatcher\ReplayWatcher.csproj -c Release -- --dir .\REPLAYS --process-existing
```

## Build standalone EXE

From repository root:

```powershell
& "C:\Program Files\dotnet\dotnet.exe" publish .\src\ReplayWatcher\ReplayWatcher.csproj -c Release -r win-x64 --self-contained true /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true -o .\dist\ReplayWatcher
```

Published executable:

- `dist\ReplayWatcher\ReplayWatcher.exe`

Run it directly:

```powershell
.\dist\ReplayWatcher\ReplayWatcher.exe
```

## Web Dashboard & Installation

This project includes a **React Web Dashboard** that monitors your replays and visualizes the match stats, rankings, and killfeed in real-time.

### Installation & Usage

The web dashboard is now **fully embedded** into the `ReplayWatcher` executable! You do **not** need Node.js, Vite, or any other tools. 

1. Download the latest `ReplayWatcher.zip` (or EXE) from the Releases page.
2. Run `ReplayWatcher.exe`.
3. The executable will watch your replays in the background and **automatically open your default browser** to the dashboard (`http://localhost:5142`).

*That's it! As long as the command prompt window is open, the dashboard is live and updates instantly when a new replay is saved.*

### Advanced / Development

If you wish to modify the React code, you can find the source in `ReplayDashboard.Client`. To run it in dev mode:
1. Ensure Node.js is installed.
2. Run `npm install` then `npm run dev`.
3. The Vite server will automatically start the C# watcher in the background for you.

## Troubleshooting

- Replay directory not found (Watcher):
	- If `%LOCALAPPDATA%\FortniteGame\Saved\Demos` does not exist yet, the watcher keeps running and waits.
	- Start Fortnite once and finish a match so the folder gets created, or pass a custom folder with `--dir <path>`.
- No output files are written:
	- Ensure your input path points to a real `*.replay` file or a folder containing replay files.
	- By default, exports are written to `REPLAYS/PARSED` (or `<watch-dir>/<output-subdir>` in watcher mode).
	- You can force a custom output directory with `--output-root <path>`.
- File access errors while a replay is being written:
	- Replays may still be locked by Fortnite while recording.
	- Wait a few seconds and retry; `ReplayWatcher` retries automatically after files become stable.
- Build or run fails with missing SDK/runtime:
	- Check your SDK version with `dotnet --info`.
	- Install/update .NET 10 SDK: `winget install --id Microsoft.DotNet.SDK.10 --exact`.

## Notes

- Parser/model logic is based on the original .NET implementation.
- Console tools add reporting and export behavior on top.
- TXT output is formatted for scanability and intended to stay stable over time.


