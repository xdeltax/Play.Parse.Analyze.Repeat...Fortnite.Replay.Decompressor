using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using FortniteReplayReader;
using FortniteReplayReader.Models;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Unreal.Core.Models.Enums;

internal static class ReplayAnalyzer
{
    private static double GetKillfeedTimeOffsetSeconds(FortniteReplay replay)
    {
        // For standard Fortnite matches, the first safe zone shrink countdown is 240s (4 minutes) before it starts shrinking.
        // Therefore, (First SafeZone StartShrinkTime) - 240 seconds = Match start time (when the bus starts / warmup ends).
        var firstSafeZone = replay.MapData?.SafeZones?.FirstOrDefault();
        if (firstSafeZone?.StartShrinkTime > 240)
        {
            return (double)firstSafeZone.StartShrinkTime - 240.0;
        }

        return replay.GameData?.WarmupCountdownEndTime
            ?? replay.GameData?.AircraftStartTime
            ?? replay.GameData?.SafeZonesStartTime
            ?? 0;
    }

    internal sealed record ReplayProcessResult(string ReplayFilePath, string JsonPath, string TxtPath, string JsonText, string AnalysisText);

    public static void Run(string[] args)
    {
        var options = ParseOptions(args);

        var serviceCollection = new ServiceCollection()
            .AddLogging(loggingBuilder => loggingBuilder
                .AddConsole()
                .SetMinimumLevel(LogLevel.Warning));
        var provider = serviceCollection.BuildServiceProvider();
        var loggerFactory = provider.GetService<ILoggerFactory>();
        var logger = loggerFactory?.CreateLogger("ReplayAnalyzer");

        IEnumerable<string> replayFiles = File.Exists(options.InputPath)
            ? new[] { options.InputPath }
            : Directory.EnumerateFiles(options.InputPath, "*.replay");

        Directory.CreateDirectory(options.OutputRoot);

        var sw = new Stopwatch();
        long total = 0;
        var hadFailure = false;

        var reader = new ReplayReader(logger, ParseMode.Normal);

        foreach (var replayFile in replayFiles)
        {
            sw.Restart();
            try
            {
                var replay = reader.ReadReplay(replayFile);
                WriteArtifacts(replay, replayFile, options.OutputRoot);

                if (!options.Quiet)
                {
                    PrintDiagnostics(replay);
                }
            }
            catch (Exception ex)
            {
                hadFailure = true;
                Console.WriteLine(ex);
            }

            sw.Stop();
            if (!options.Quiet)
            {
                Console.WriteLine($"---- {replayFile} : done in {sw.ElapsedMilliseconds} milliseconds ----");
            }

            total += sw.ElapsedMilliseconds;
        }

        if (!options.Quiet)
        {
            Console.WriteLine($"total: {total / 1000} seconds ----");
        }

        if (hadFailure)
        {
            Environment.ExitCode = 1;
        }
    }

    public static ReplayProcessResult ProcessReplayFile(string replayFilePath, string outputRoot)
    {
        var reader = new ReplayReader(null, ParseMode.Normal);

        var replay = reader.ReadReplay(replayFilePath);
        return WriteArtifacts(replay, replayFilePath, outputRoot);
    }

    private static ReplayProcessResult WriteArtifacts(FortniteReplay replay, string replayFilePath, string outputRoot)
    {
        Directory.CreateDirectory(outputRoot);

        var baseName = Path.GetFileNameWithoutExtension(replayFilePath);
        var jsonPath = Path.Combine(outputRoot, $"{baseName}.json");
        var txtPath = Path.Combine(outputRoot, $"{baseName}.txt");

        var jsonText = JsonSerializer.Serialize(replay, new JsonSerializerOptions
        {
            WriteIndented = true,
            NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals
        });
        var analysisText = BuildTextAnalysis(replay, replayFilePath);

        File.WriteAllText(jsonPath, jsonText + Environment.NewLine);
        File.WriteAllText(txtPath, analysisText + Environment.NewLine);

        return new ReplayProcessResult(replayFilePath, jsonPath, txtPath, jsonText, analysisText);
    }

    private static string BuildTextAnalysis(FortniteReplay replay, string replayFilePath)
    {
        var players = replay.PlayerData?.ToList() ?? new List<PlayerData>();
        var playersById = players
            .Where(p => p.Id.HasValue)
            .GroupBy(p => p.Id!.Value)
            .ToDictionary(g => g.Key, g => g.First());
        var killFeed = replay.KillFeed?.ToList() ?? new List<KillFeedEntry>();

        var teamRankedPlayers = players
            .Where(p => p.Placement.HasValue && p.Placement.Value > 0)
            .OrderBy(p => p.Placement)
            .ThenBy(p => p.TeamIndex ?? int.MaxValue)
            .ThenByDescending(p => p.DeathTimeDouble ?? (double?)p.DeathTime ?? double.MaxValue)
            .ThenByDescending(p => p.Kills ?? 0)
            .ThenBy(p => p.PlayerId ?? string.Empty)
            .ToList();
        var teamUnrankedAliveRealPlayers = players
            .Where(p => !p.IsBot && (!p.Placement.HasValue || p.Placement.Value <= 0))
            .OrderBy(p => p.TeamIndex ?? int.MaxValue)
            .ThenByDescending(p => p.DeathTimeDouble ?? (double?)p.DeathTime ?? double.MaxValue)
            .ThenByDescending(p => p.Kills ?? 0)
            .ThenBy(p => GetPlayerDisplayName(p), StringComparer.OrdinalIgnoreCase)
            .ToList();

        var normalRankedPlayers = players
            .Where(p => p.Placement.HasValue && p.Placement.Value > 0)
            .OrderBy(p => p.Placement)
            .ThenByDescending(p => p.Kills ?? 0)
            .ThenBy(p => p.PlayerId ?? string.Empty)
            .ToList();
        var normalUnrankedAliveRealPlayers = players
            .Where(p => !p.IsBot && (!p.Placement.HasValue || p.Placement.Value <= 0))
            .OrderByDescending(p => p.Kills ?? 0)
            .ThenBy(p => GetPlayerDisplayName(p), StringComparer.OrdinalIgnoreCase)
            .ToList();

        var owner = players.FirstOrDefault(p => p.IsReplayOwner);
        var ownerById = owner?.Id;
        var ownerFeedEvents = ownerById.HasValue
            ? killFeed.Where(k => k.FinisherOrDowner == ownerById.Value && !k.IsRevived).ToList()
            : new List<KillFeedEntry>();
        var ownerKnocks = ownerFeedEvents.Count(k => k.IsDowned);
        var ownerRankingKills = owner?.Kills ?? 0;
        var durationSeconds = replay.Info?.LengthInMs > 0 ? replay.Info.LengthInMs / 1000.0 : 0;
        var realPlayers = players.Count(p => !p.IsBot);
        var botPlayers = players.Count(p => p.IsBot && !string.IsNullOrWhiteSpace(p.BotId));
        var npcPlayers = players.Count(p => p.IsBot && string.IsNullOrWhiteSpace(p.BotId));
        var crownPlayers = players.Count(p => !p.IsBot && p.HasCrown);
        var hardSum = realPlayers + botPlayers + npcPlayers;
        var totalPlayers = replay.TeamStats is not null && replay.TeamStats.TotalPlayers > 0
            ? (int)replay.TeamStats.TotalPlayers
            : hardSum;
        static string FormatSummaryLine(string label, string value) => $"{label} {value}";

        var gameVersion = replay.Header?.Branch is not null
            ? (System.Text.RegularExpressions.Regex.Match(replay.Header.Branch, @"Release-(\d+\.\d+)") is { Success: true } m ? $"v{m.Groups[1].Value}" : replay.Header.Branch)
            : "unknown";

        var gameMode = GetGameMode(replay.GameData?.CurrentPlaylist);
        var playersPerTeam = GetPlayersPerTeam(replay.GameData?.CurrentPlaylist);
        var teamsInMatch = replay.GameData?.TeamSize is int ts and > 0 ? ts : (int?)null;
        var largeTeam = replay.GameData?.IsLargeTeamGame == true ? " [Large Team]" : string.Empty;
        var modeDetail = playersPerTeam > 0
            ? $"{gameMode}{largeTeam}  ({playersPerTeam}v{playersPerTeam})"
            : $"{gameMode}{largeTeam}";
        var teamsDetail = teamsInMatch.HasValue ? $" | {teamsInMatch.Value} Teams" : string.Empty;

        var lines = new List<string>
        {
            $"File : {Path.GetFileNameWithoutExtension(replayFilePath)}",
            FormatSummaryLine("Match:", $"{ToIsoOrUnknown(replay.Info?.Timestamp)}; Duration: {FormatDurationMmSs(durationSeconds)}"),
            $"       Mode         : {modeDetail}{teamsDetail}",
            $"       Game Version : {gameVersion}",
            $"       Session ID   : {replay.GameData?.GameSessionId ?? "unknown"}",
            $"       {totalPlayers} Total Players",
            $"       {realPlayers} Real Players ",
            $"       {botPlayers} BOT Players",
            $"       {npcPlayers} NPCs",
            $"       {hardSum} in Sum",
            $"       {crownPlayers} {(crownPlayers == 1 ? "Player" : "Players")} with Crown"
        };

        if (owner is null)
        {
            lines.Add("Owner: unknown");
            lines.Add("       Accuracy unknown; Assists unknown; Revives unknown; Damage: unknown Given; unknown Received");
            lines.Add("       Rank#: unknown");
            lines.Add("       killed 0 / knocked 0; ");
            lines.Add("Owner Killfeed:");
            lines.Add("  (no kills)");
            lines.Add(string.Empty);
        }
        else
        {
            var ownerRank = owner.Placement.HasValue ? $"#{owner.Placement.Value:00}" : "unknown";
            var ownerDisplayId = GetPlayerDisplayName(owner);
            var ownerAssists = replay.Stats?.Assists;
            var ownerRevives = replay.Stats?.Revives;
            var ownerDamageGiven = replay.Stats?.DamageToPlayers;
            var ownerDamageReceived = replay.Stats?.DamageTaken;
            var ownerAccuracyPercent = replay.Stats is null ? (double?)null : replay.Stats.Accuracy * 100.0;

            var ownerEpicId = string.IsNullOrWhiteSpace(owner.PlayerId) ? "unknown" : owner.PlayerId;
            lines.Add($"Owner: {ownerDisplayId} ({ownerEpicId})");
            lines.Add($"       Rank#: {ownerRank}");
            lines.Add($"       killed {ownerRankingKills} / knocked {ownerKnocks}; ");

            if (owner.DeathTimeDouble.HasValue || owner.DeathTime.HasValue)
            {
                var deathTime = GetNormalizedEventTimeSeconds(replay, owner.DeathTimeDouble ?? owner.DeathTime);
                var ownerDeathEntry = ownerById.HasValue
                    ? killFeed
                        .Where(k => k.PlayerId == ownerById.Value && !k.IsRevived)
                        .OrderByDescending(k => GetNormalizedEventTimeSeconds(replay, k) ?? double.MinValue)
                        .FirstOrDefault()
                    : null;
                var killerType = "unknown";
                var killerIdOrName = ownerDeathEntry?.FinisherOrDownerName;
                if (ownerDeathEntry?.FinisherOrDowner is int killerId && playersById.TryGetValue(killerId, out var killerPlayer))
                {
                    killerType = GetDeathTypeLabel(killerPlayer);
                    killerIdOrName = GetPlayerDisplayName(killerPlayer);
                }
                else if (ownerDeathEntry is not null)
                {
                    killerType = ownerDeathEntry.FinisherOrDownerIsBot ? "BOT Player" : "Real Player";
                }

                if (string.IsNullOrWhiteSpace(killerIdOrName))
                {
                    killerIdOrName = "unknown";
                }

                var deathDist = ownerDeathEntry?.Distance is float dist and > 0
                    ? $" | dist: {FormatDistanceMeters(dist)}"
                    : string.Empty;
                var deathWeapon = ExtractWeaponFromTags(ownerDeathEntry?.DeathTags);
                var deathWeaponStr = deathWeapon is not null ? $" | via: {deathWeapon}" : string.Empty;
                lines.Add($"       Killed at {FormatDurationMmSs(deathTime.GetValueOrDefault())} by {killerType} ({killerIdOrName}){deathDist}{deathWeaponStr}");
            }

            lines.Add($"       Accuracy {(ownerAccuracyPercent.HasValue ? $"{ownerAccuracyPercent.Value:F1}%" : "unknown")}; Assists {FormatCompactMetric(ownerAssists)}; Revives {FormatCompactMetric(ownerRevives)}; Damage: {(ownerDamageGiven.HasValue ? ownerDamageGiven.Value.ToString() : "unknown")} Given; {(ownerDamageReceived.HasValue ? ownerDamageReceived.Value.ToString() : "unknown")} Received");

            if (replay.Stats is not null)
            {
                var traveled = replay.Stats.TotalTraveled > 0 ? $"{replay.Stats.TotalTraveled / 100.0:F0} m" : "?";
                lines.Add($"       Structures Dmg: {replay.Stats.DamageToStructures}; Materials: {replay.Stats.MaterialsGathered} gathered / {replay.Stats.MaterialsUsed} used; Travel: {traveled}");
            }

            if (owner.HasCrown)
            {
                lines.Add("       Owner has Crown");
            }

            // Owner cosmetics
            if (owner.Cosmetics is not null)
            {
                var skin = owner.Cosmetics.Character ?? "?";
                var pickaxe = owner.Cosmetics.Pickaxe ?? "?";
                var glider = owner.Cosmetics.Glider ?? "?";
                var backpack = owner.Cosmetics.Backpack ?? "-";
                lines.Add($"       Skin: {skin} | Pickaxe: {pickaxe} | Glider: {glider} | Backpack: {backpack}");
            }

            lines.Add(string.Empty);
            var ownerTeamIndex = owner.TeamIndex;
            var teammates = ownerTeamIndex.HasValue ? players.Where(p => p.TeamIndex == ownerTeamIndex.Value).ToList() : new List<PlayerData> { owner };
            var teamKills = teammates.Sum(p => p.Kills ?? 0);
            
            var teamIds = teammates.Where(p => p.Id.HasValue).Select(p => p.Id!.Value).ToHashSet();
            var teamKnocks = killFeed.Count(k => k.FinisherOrDowner.HasValue && teamIds.Contains(k.FinisherOrDowner.Value) && k.IsDowned && !k.IsRevived);
            var teamRevivesFromFeed = killFeed.Count(k => k.FinisherOrDowner.HasValue && teamIds.Contains(k.FinisherOrDowner.Value) && k.IsRevived);
            var teamRevivesDisplay = Math.Max(teamRevivesFromFeed, ownerRevives ?? 0);

            var teamStr = ownerTeamIndex.HasValue ? $"Team {ownerTeamIndex.Value:00}" : "Team ??";
            lines.Add($"Owner Team ({teamStr}):");
            lines.Add($"       {teammates.Count} Players | Team Kills: {teamKills} | Team Knocks: {teamKnocks} | Team Revives: {teamRevivesDisplay}");
            
            foreach (var teammate in teammates.OrderByDescending(p => p.DeathTimeDouble ?? (double?)p.DeathTime ?? double.MaxValue).ThenByDescending(p => p.Kills ?? 0).ThenBy(p => GetPlayerDisplayName(p)))
            {
                 var teammateKills = teammate.Kills ?? 0;
                 var teammateKnocks = teammate.Id.HasValue ? killFeed.Count(k => k.FinisherOrDowner == teammate.Id.Value && k.IsDowned && !k.IsRevived) : 0;
                 var teammateDamage = teammate.IsReplayOwner ? (ownerDamageGiven?.ToString() ?? "?") : "?";
                 var teammateState = (teammate.DeathTimeDouble.HasValue || teammate.DeathTime.HasValue) ? "Dead " : "Alive";
                 lines.Add($"       - {FormatDisplayNameWithCrown(teammate).PadRight(20)} | Kills: {teammateKills,2} | Knocks: {teammateKnocks,2} | Dmg: {teammateDamage,4} | {teammateState}");
            }
            lines.Add(string.Empty);

            lines.Add("Owner Killfeed:");

            if (ownerFeedEvents.Count == 0)
            {
                lines.Add("  (no kills)");
            }
            else
            {
                var killfeedVictimWidth = ownerFeedEvents
                    .Select(entry =>
                    {
                        PlayerData? victimPlayer = null;
                        if (entry.PlayerId.HasValue)
                        {
                            playersById.TryGetValue(entry.PlayerId.Value, out victimPlayer);
                        }

                        return victimPlayer is not null
                            ? FormatDisplayNameWithCrown(victimPlayer)
                            : (!string.IsNullOrWhiteSpace(entry.PlayerName)
                                ? entry.PlayerName
                                : (entry.PlayerId.HasValue ? $"PlayerID:{entry.PlayerId.Value}" : "unknown"));
                    })
                    .DefaultIfEmpty("unknown")
                    .Max(name => name.Length);

                for (var i = 0; i < ownerFeedEvents.Count; i++)
                {
                    var entry = ownerFeedEvents[i];
                    var tag = entry.PlayerIsBot ? "BOT " : "Real";
                    var action = entry.IsDowned ? "knocked" : "killed!";
                    PlayerData? victimPlayer = null;
                    if (entry.PlayerId.HasValue)
                    {
                        playersById.TryGetValue(entry.PlayerId.Value, out victimPlayer);
                    }

                    if (victimPlayer is not null)
                    {
                        tag = GetKillfeedTag(victimPlayer);
                    }

                    var victim = victimPlayer is not null
                        ? FormatDisplayNameWithCrown(victimPlayer)
                        : (!string.IsNullOrWhiteSpace(entry.PlayerName)
                            ? entry.PlayerName
                            : (entry.PlayerId.HasValue ? $"PlayerID:{entry.PlayerId.Value}" : "unknown"));
                    var time = GetNormalizedEventTimeSeconds(replay, entry);
                    var timeFmt = time.HasValue ? FormatDurationMmSs(time.Value) : "??:??";
                    var victimRankNum = victimPlayer?.Placement.HasValue == true ? (int?)victimPlayer.Placement.Value : null;
                    var victimRankStr = victimRankNum.HasValue ? $"{victimRankNum.Value,2}" : "??";
                    var victimKillsStr = victimPlayer is not null ? $" ({victimPlayer.Kills ?? 0} kills)" : string.Empty;
                    var feedDist = entry.Distance is float d and > 0 ? $" | {FormatDistanceMeters(d)}" : string.Empty;
                    var feedWeapon = ExtractWeaponFromTags(entry.DeathTags);
                    var feedWeaponStr = feedWeapon is not null ? $" | {feedWeapon}" : string.Empty;
                    lines.Add($"  {i + 1,2}. [{timeFmt}] {action}: [{tag}] {victim.PadRight(killfeedVictimWidth)} | Rank: {victimRankStr}{victimKillsStr}{feedDist}{feedWeaponStr}");
                }
            }

            lines.Add(string.Empty);
        }

        var lowerPlaylist = (replay.GameData?.CurrentPlaylist ?? string.Empty).ToLowerInvariant();
        var isSoloMatch = lowerPlaylist.Contains("solo");

        if (!isSoloMatch)
        {
            AppendRanking(lines, "Team-Ranking", teamRankedPlayers, teamUnrankedAliveRealPlayers, isTeamRanking: true, replay, playersById, killFeed);
            lines.Add(string.Empty);
        }
        AppendRanking(lines, "Ranking", normalRankedPlayers, normalUnrankedAliveRealPlayers, isTeamRanking: false, replay, playersById, killFeed);

        return string.Join(Environment.NewLine, lines);
    }

    private static void AppendRanking(
        List<string> lines,
        string title,
        List<PlayerData> rankedPlayers,
        List<PlayerData> unrankedAliveRealPlayers,
        bool isTeamRanking,
        FortniteReplay replay,
        Dictionary<int, PlayerData> playersById,
        List<KillFeedEntry> killFeed)
    {
        lines.Add(title);

        if (rankedPlayers.Count == 0 && unrankedAliveRealPlayers.Count == 0)
        {
            lines.Add("No usable player data found.");
        }
        else
        {
            var allRankingPlayers = rankedPlayers.Concat(unrankedAliveRealPlayers).ToList();
            var idWidth = Math.Max(12, allRankingPlayers.Max(player => FormatDisplayNameWithCrown(player).Length));

            foreach (var player in unrankedAliveRealPlayers)
            {
                var baseDisplayId = FormatDisplayNameWithCrown(player);
                var kills = player.Kills ?? 0;
                var level = FormatLevel(player.Level);
                var seasonLevel = FormatLevel(player.SeasonLevelUIDisplay);
                var platform = string.IsNullOrWhiteSpace(player.Platform) ? "unknown" : player.Platform;
                var teamPrefix = player.TeamIndex.HasValue ? $"[T{player.TeamIndex.Value:00}]" : "[T??]";
                var rebootStr = isTeamRanking && player.RebootCounter.HasValue ? $" | Reboots: {player.RebootCounter.Value}" : string.Empty;
                var line = $"#?? * {teamPrefix} {baseDisplayId.PadRight(idWidth)} | Real  | Kills: {kills,2} | Level: {level} ({seasonLevel}) | Platform: {platform}{rebootStr}";
                lines.Add(line);
                AppendPlayerDetails(lines, player, replay, playersById, killFeed);
            }

            foreach (var player in rankedPlayers)
            {
                var baseDisplayId = FormatDisplayNameWithCrown(player);
                var kills = player.Kills ?? 0;
                var teamPrefix = player.TeamIndex.HasValue ? $"[T{player.TeamIndex.Value:00}]" : "[T??]";
                var rebootStr = isTeamRanking && player.RebootCounter.HasValue ? $" | Reboots: {player.RebootCounter.Value}" : string.Empty;
                string line;

                if (player.IsReplayOwner)
                {
                    var level = FormatLevel(player.Level);
                    var seasonLevel = FormatLevel(player.SeasonLevelUIDisplay);
                    var platform = string.IsNullOrWhiteSpace(player.Platform) ? "unknown" : player.Platform;
                    var skin = FormatCosmeticShort(player.Cosmetics?.Character);
                    line = $"#{player.Placement.GetValueOrDefault(),2:00} * {teamPrefix} {baseDisplayId.PadRight(idWidth)} * OWNER * Kills: {kills,2} | Level: {level} ({seasonLevel}) | Platform: {platform} | Skin: {skin}{rebootStr}";
                }
                else if (!player.IsBot)
                {
                    var level = FormatLevel(player.Level);
                    var seasonLevel = FormatLevel(player.SeasonLevelUIDisplay);
                    var platform = string.IsNullOrWhiteSpace(player.Platform) ? "unknown" : player.Platform;
                    var skin = FormatCosmeticShort(player.Cosmetics?.Character);
                    line = $"#{player.Placement.GetValueOrDefault(),2:00} * {teamPrefix} {baseDisplayId.PadRight(idWidth)} | Real  | Kills: {kills,2} | Level: {level} ({seasonLevel}) | Platform: {platform} | Skin: {skin}{rebootStr}";
                }
                else
                {
                    var type = string.IsNullOrWhiteSpace(player.BotId) ? "NPC  " : "BOT  ";
                    line = $"#{player.Placement.GetValueOrDefault(),2:00} | {teamPrefix} {baseDisplayId.PadRight(idWidth)} | {type} | Kills: {kills,2}";
                }

                lines.Add(line);
                AppendPlayerDetails(lines, player, replay, playersById, killFeed);
            }
        }
    }

    private static void AppendPlayerDetails(
        List<string> lines,
        PlayerData player,
        FortniteReplay replay,
        Dictionary<int, PlayerData> playersById,
        List<KillFeedEntry> killFeed)
    {
        var hasDeathTime = player.DeathTimeDouble.HasValue || player.DeathTime.HasValue;
        var deathEntry = player.Id.HasValue
            ? killFeed
                .Where(k => k.PlayerId == player.Id.Value && !k.IsRevived)
                .OrderByDescending(k => GetNormalizedEventTimeSeconds(replay, k) ?? double.MinValue)
                .FirstOrDefault()
            : null;

        if (hasDeathTime || deathEntry is not null)
        {
            var deathTime = GetNormalizedEventTimeSeconds(replay, player.DeathTimeDouble ?? player.DeathTime);
            var killerType = "unknown";
            var killerIdOrName = deathEntry?.FinisherOrDownerName;
            if (deathEntry?.FinisherOrDowner is int killerId && playersById.TryGetValue(killerId, out var killerPlayer))
            {
                killerType = GetDeathTypeLabel(killerPlayer);
                killerIdOrName = GetPlayerDisplayName(killerPlayer);
            }
            else if (deathEntry is not null)
            {
                killerType = deathEntry.FinisherOrDownerIsBot ? "BOT Player" : "Real Player";
            }

            if (string.IsNullOrWhiteSpace(killerIdOrName))
            {
                killerIdOrName = "unknown";
            }

            var deathDist = deathEntry?.Distance is float dist and > 0
                ? $" | dist: {FormatDistanceMeters(dist)}"
                : string.Empty;
            var deathWeapon = ExtractWeaponFromTags(deathEntry?.DeathTags);
            var deathWeaponStr = deathWeapon is not null ? $" | via: {deathWeapon}" : string.Empty;
            var timeStr = deathTime.HasValue ? FormatDurationMmSs(deathTime.Value) : "??:??";

            lines.Add($"\t[Death] Killed at {timeStr} by {killerType} ({killerIdOrName}){deathDist}{deathWeaponStr}");
        }

        var feedEvents = player.Id.HasValue
            ? killFeed.Where(k => k.FinisherOrDowner == player.Id.Value && !k.IsRevived).ToList()
            : new List<KillFeedEntry>();

        if (feedEvents.Count > 0)
        {
            for (var j = 0; j < feedEvents.Count; j++)
            {
                var entry = feedEvents[j];
                var tag = entry.PlayerIsBot ? "BOT " : "Real";
                var action = entry.IsDowned ? "knocked" : "killed!";
                PlayerData? victimPlayer = null;
                if (entry.PlayerId.HasValue)
                {
                    playersById.TryGetValue(entry.PlayerId.Value, out victimPlayer);
                }

                if (victimPlayer is not null)
                {
                    tag = GetKillfeedTag(victimPlayer);
                }

                var victimName = victimPlayer is not null
                    ? FormatDisplayNameWithCrown(victimPlayer)
                    : (!string.IsNullOrWhiteSpace(entry.PlayerName)
                        ? entry.PlayerName
                        : (entry.PlayerId.HasValue ? $"PlayerID:{entry.PlayerId.Value}" : "unknown"));
                var time = GetNormalizedEventTimeSeconds(replay, entry);
                var timeFmt = time.HasValue ? FormatDurationMmSs(time.Value) : "??:??";
                var victimRankNum = victimPlayer?.Placement.HasValue == true ? (int?)victimPlayer.Placement.Value : null;
                var victimRankStr = victimRankNum.HasValue ? $"{victimRankNum.Value,2}" : "??";
                var feedDist = entry.Distance is float d and > 0 ? $" | {FormatDistanceMeters(d)}" : string.Empty;
                var feedWeapon = ExtractWeaponFromTags(entry.DeathTags);
                var feedWeaponStr = feedWeapon is not null ? $" | {feedWeapon}" : string.Empty;
                lines.Add($"\t[{timeFmt}] {action}: [{tag}] {victimName} | Rank: {victimRankStr}{feedDist}{feedWeaponStr}");
            }
        }
    }

    /// <summary>Formats a distance from Unreal Units (cm) to meters with XXX.X m layout.</summary>
    private static string FormatDistanceMeters(float unrUnits)
    {
        var meters = unrUnits / 100.0f;
        return $"{meters,5:F1} m";
    }

    /// <summary>Strips common prefixes from cosmetic asset names for compact display.</summary>
    private static string FormatCosmeticShort(string? assetName)
    {
        if (string.IsNullOrWhiteSpace(assetName)) return "-";
        // Strip common prefixes like CID_XXX_Athena_Commando_M_ / CID_A_XXX_...
        var stripped = System.Text.RegularExpressions.Regex.Replace(assetName,
            @"^(CID_[A-Z]?_?\d+_Athena_Commando_[MF]_)",
            "", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        return stripped.Length > 0 ? stripped : assetName;
    }

    /// <summary>Attempts to extract a human-readable weapon name from DeathTags gameplay tags.</summary>
    private static string? ExtractWeaponFromTags(IEnumerable<string>? tags)
    {
        if (tags is null) return null;

        // Priority: look for item.weapon or Item.Weapon tags first (most specific)
        foreach (var tag in tags)
        {
            if (tag.StartsWith("item.weapon.ranged.", StringComparison.OrdinalIgnoreCase))
            {
                var parts = tag.Split('.');
                // e.g. item.weapon.ranged.assault.SunRose → "Assault: SunRose"
                if (parts.Length >= 5) return $"{Capitalize(parts[3])}: {parts[4]}";
                if (parts.Length >= 4) return Capitalize(parts[3]);
            }
            if (tag.StartsWith("Item.Weapon.Ranged.", StringComparison.OrdinalIgnoreCase))
            {
                var parts = tag.Split('.');
                // e.g. Item.Weapon.Ranged.SMG.DragonCart → "SMG: DragonCart"
                if (parts.Length >= 5) return $"{parts[3]}: {parts[4]}";
                if (parts.Length >= 4) return parts[3];
            }
        }

        // Fallback: Weapon.Ranged.XXX
        foreach (var tag in tags)
        {
            if (tag.StartsWith("Weapon.Ranged.", StringComparison.OrdinalIgnoreCase))
            {
                var parts = tag.Split('.');
                if (parts.Length >= 3) return Capitalize(parts[2]);
            }
        }

        // Storm/environment damage
        foreach (var tag in tags)
        {
            if (tag.Contains("OutsideSafeZone", StringComparison.OrdinalIgnoreCase)) return "Storm";
            if (tag.Contains("FallDamage", StringComparison.OrdinalIgnoreCase)) return "Fall Damage";
        }

        return null;
    }

    private static string Capitalize(string s)
    {
        if (string.IsNullOrEmpty(s)) return s;
        return char.ToUpperInvariant(s[0]) + s[1..];
    }

    private static double? GetNormalizedEventTimeSeconds(FortniteReplay replay, KillFeedEntry entry)
    {
        return GetNormalizedEventTimeSeconds(replay, entry.ReplicatedWorldTimeSecondsDouble ?? entry.ReplicatedWorldTimeSeconds);
    }

    private static double? GetNormalizedEventTimeSeconds(FortniteReplay replay, double? eventTimeSeconds)
    {
        if (!eventTimeSeconds.HasValue)
        {
            return null;
        }

        return Math.Max(0, eventTimeSeconds.Value - GetKillfeedTimeOffsetSeconds(replay));
    }



    private static string GetPlayerDisplayName(PlayerData? player)
    {
        if (player is null)
        {
            return "unknown";
        }

        if (!string.IsNullOrWhiteSpace(player.PlayerName))
        {
            return player.PlayerName;
        }

        if (!string.IsNullOrWhiteSpace(player.PlayerNameCustomOverride))
        {
            return player.PlayerNameCustomOverride;
        }

        if (!string.IsNullOrWhiteSpace(player.PlayerId))
        {
            return player.PlayerId;
        }

        return "unknown";
    }

    private static string FormatDisplayNameWithCrown(PlayerData? player)
    {
        var displayName = GetPlayerDisplayName(player);
        return player?.HasCrown == true ? $"{displayName} (Crown)" : displayName;
    }

    private static string GetKillfeedTag(PlayerData? player)
    {
        if (player is null)
        {
            return "unknown";
        }

        if (!player.IsBot)
        {
            return "Real";
        }

        return string.IsNullOrWhiteSpace(player.BotId) ? "NPC " : "BOT ";
    }

    private static string GetDeathTypeLabel(PlayerData? player)
    {
        if (player is null)
        {
            return "unknown";
        }

        if (!player.IsBot)
        {
            return "Real Player";
        }

        return string.IsNullOrWhiteSpace(player.BotId) ? "NPC" : "BOT Player";
    }

    private static void PrintDiagnostics(FortniteReplay replay)
    {
        var players = replay.PlayerData?.ToList() ?? new List<PlayerData>();
        var replayOwners = players.Where(p => p.IsReplayOwner).ToList();

        Console.WriteLine("Replay Owner Diagnostics");
        Console.WriteLine("----------------------");
        Console.WriteLine($"RecorderId (GameData): {replay.GameData?.RecorderId?.ToString() ?? "null"}");
        Console.WriteLine($"PlayerData Count:       {players.Count}");
        Console.WriteLine($"ReplayOwner Count:      {replayOwners.Count}");

        if (replayOwners.Count == 0)
        {
            Console.WriteLine("ReplayOwner Players:    (none)");
            Console.WriteLine();
            return;
        }

        Console.WriteLine("ReplayOwner Players:");
        foreach (var owner in replayOwners)
        {
            Console.WriteLine($"  - Id={owner.Id?.ToString() ?? "null"}, PlayerId={owner.PlayerId ?? "null"}, Name={owner.PlayerName ?? owner.PlayerNameCustomOverride ?? "null"}, IsBot={owner.IsBot}");
        }

        Console.WriteLine();
    }

    private static string NormalizeFriendlyName(string? friendlyName, string replayFilePath)
    {
        var name = (friendlyName ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            return Path.GetFileNameWithoutExtension(replayFilePath);
        }

        if (string.Equals(name, "ungespeicherte wiederholung", StringComparison.OrdinalIgnoreCase))
        {
            return "Unsaved Replay";
        }

        if (string.Equals(name, "unbenannt", StringComparison.OrdinalIgnoreCase))
        {
            return "Untitled Replay";
        }

        return name;
    }

    private static string FormatCompactMetric(uint? value)
    {
        return value.HasValue ? value.Value.ToString() : "unknown";
    }

    private static string ToIsoOrUnknown(DateTime? dateTime)
    {
        if (!dateTime.HasValue)
        {
            return "unknown";
        }

        return dateTime.Value.ToUniversalTime().ToString("O");
    }

    private static string FormatDurationMmSs(double totalSeconds)
    {
        var safeSeconds = Math.Max(0, totalSeconds);
        var minutes = (int)Math.Floor(safeSeconds / 60);
        var seconds = (int)Math.Floor(safeSeconds % 60);
        return $"{minutes:00}:{seconds:00}";
    }

    private static string FormatLevel(int? value)
    {
        return value.HasValue ? value.Value.ToString().PadLeft(3) : "???";
    }

    private static string FormatLevel(uint? value)
    {
        return value.HasValue ? value.Value.ToString().PadLeft(3) : "???";
    }

    private static string GetGameMode(string? playlist)
    {
        if (string.IsNullOrWhiteSpace(playlist)) return "UNKNOWN";
        var lower = playlist.ToLowerInvariant();
        if (lower.Contains("solo")) return "SOLO";
        if (lower.Contains("duo")) return "DUOS";
        if (lower.Contains("trio")) return "TRIOS";
        if (lower.Contains("squad")) return "SQUADS";
        if (lower.Contains("50v50")) return "50v50";
        if (lower.Contains("teamrumble")) return "TEAM RUMBLE";
        if (lower.Contains("creative")) return "CREATIVE";
        if (lower.Contains("respawn")) return "TEAM RUMBLE";
        return playlist; // fallback
    }

    private static int GetPlayersPerTeam(string? playlist)
    {
        if (string.IsNullOrWhiteSpace(playlist)) return 0;
        var lower = playlist.ToLowerInvariant();
        if (lower.Contains("solo")) return 1;
        if (lower.Contains("duo")) return 2;
        if (lower.Contains("trio")) return 3;
        if (lower.Contains("squad")) return 4;
        return 0; // unknown / large-team modes
    }

    private static AppOptions ParseOptions(string[] args)
    {
        var inputPath = @"C:\Users\ferro\Downloads\";
        var workspaceRoot = ResolveWorkspaceRoot();
        var outputRoot = Path.Combine(workspaceRoot, "REPLAYS", "PARSED");
        var quiet = false;

        for (var i = 0; i < args.Length; i++)
        {
            var current = args[i];
            if (current == "--output-root" && i + 1 < args.Length)
            {
                outputRoot = Path.GetFullPath(args[++i]);
                continue;
            }

            if (current == "--quiet")
            {
                quiet = true;
                continue;
            }

            if (!current.StartsWith("--", StringComparison.Ordinal))
            {
                inputPath = Path.GetFullPath(current);
            }
        }

        return new AppOptions(inputPath, outputRoot, quiet);
    }

    private static string ResolveWorkspaceRoot()
    {
        var current = Directory.GetCurrentDirectory();

        while (true)
        {
            if (Directory.Exists(Path.Combine(current, "REPLAYS")))
            {
                return current;
            }

            var parent = Directory.GetParent(current);
            if (parent is null)
            {
                return Directory.GetCurrentDirectory();
            }

            current = parent.FullName;
        }
    }

    private sealed record AppOptions(string InputPath, string OutputRoot, bool Quiet);
}
