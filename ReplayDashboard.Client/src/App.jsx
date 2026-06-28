import React, { useState, useEffect } from 'react';
import { useStore } from './store';
import './index.css';

const App = () => {
  const { replays, sourceReplays, status, selectedReplay, parsingTarget, fetchData, setSelectedReplay, reparse } = useStore();
  const [currentReplayData, setCurrentReplayData] = useState(null);
  const [rankingTab, setRankingTab] = useState('team'); // 'team' or 'individual'
  const [expandedPlayers, setExpandedPlayers] = useState({});

  const toggleExpand = (playerId) => {
    if (playerId === undefined || playerId === null) return;
    setExpandedPlayers(prev => ({
      ...prev,
      [playerId]: !prev[playerId]
    }));
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 2000);
    return () => clearInterval(interval);
  }, [fetchData]);

  useEffect(() => {
    if (selectedReplay) {
      fetch(`http://localhost:5142/api/replays/${encodeURIComponent(selectedReplay)}`)
        .then(res => res.json())
        .then(data => setCurrentReplayData(data))
        .catch(err => {
          console.error('Failed to load replay data:', err);
          setCurrentReplayData(null);
        });
    } else {
      setCurrentReplayData(null);
    }
  }, [selectedReplay]);

  // Helpers
  const formatTime = (ms) => {
    if (!ms) return '--:--';
    const totalSeconds = Math.floor(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const getGameMode = (playlist) => {
    if (!playlist) return 'UNKNOWN';
    const l = playlist.toLowerCase();
    if (l.includes('solo')) return 'SOLO';
    if (l.includes('duo')) return 'DUOS';
    if (l.includes('trio')) return 'TRIOS';
    if (l.includes('squad')) return 'SQUADS';
    if (l.includes('50v50')) return '50v50';
    if (l.includes('teamrumble')) return 'TEAM RUMBLE';
    if (l.includes('creative')) return 'CREATIVE';
    if (l.includes('respawn')) return 'TEAM RUMBLE';
    return playlist.toUpperCase();
  };

  const getPlayersPerTeam = (playlist) => {
    if (!playlist) return 0;
    const l = playlist.toLowerCase();
    if (l.includes('solo')) return 1;
    if (l.includes('duo')) return 2;
    if (l.includes('trio')) return 3;
    if (l.includes('squad')) return 4;
    return 0;
  };

  const getPlayerDisplayName = (p) => {
    if (!p) return 'unknown';
    if (p.PlayerName && p.PlayerName.trim()) return p.PlayerName;
    if (p.PlayerNameCustomOverride && p.PlayerNameCustomOverride.trim()) return p.PlayerNameCustomOverride;
    if (p.PlayerId && p.PlayerId.trim()) return p.PlayerId;
    return 'unknown';
  };

  const getPlayerType = (p) => {
    if (!p) return 'unknown';
    if (!p.IsBot) return 'Real';
    return (!p.BotId || p.BotId.trim() === '') ? 'NPC' : 'BOT';
  };

  const formatCosmeticShort = (assetName) => {
    if (!assetName || assetName.trim() === '') return '-';
    const stripped = assetName.replace(/^(CID_[A-Z]?_?\d+_Athena_Commando_[MF]_)/i, '');
    return stripped.length > 0 ? stripped : assetName;
  };

  const capitalize = (s) => {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  };

  const extractWeaponFromTags = (tags) => {
    if (!tags || tags.length === 0) return null;
    for (const tag of tags) {
      if (tag.toLowerCase().startsWith('item.weapon.ranged.')) {
        const parts = tag.split('.');
        if (parts.length >= 5) return `${capitalize(parts[3])}: ${parts[4]}`;
        if (parts.length >= 4) return capitalize(parts[3]);
      }
      if (tag.toLowerCase().startsWith('item.weapon.ranged.')) {
        const parts = tag.split('.');
        if (parts.length >= 5) return `${parts[3]}: ${parts[4]}`;
        if (parts.length >= 4) return parts[3];
      }
    }
    for (const tag of tags) {
      if (tag.toLowerCase().startsWith('weapon.ranged.')) {
        const parts = tag.split('.');
        if (parts.length >= 3) return capitalize(parts[2]);
      }
    }
    for (const tag of tags) {
      if (tag.toLowerCase().includes('outsidesafezone')) return 'Storm';
      if (tag.toLowerCase().includes('falldamage')) return 'Fall Damage';
    }
    return null;
  };

  const getKillfeedTag = (victim, entry) => {
    if (victim) {
      if (!victim.IsBot) return 'Real';
      return (!victim.BotId || victim.BotId.trim() === '') ? 'NPC' : 'BOT';
    }
    return entry.PlayerIsBot ? 'BOT' : 'Real';
  };

  // Data processing
  const { Info, GameData, Stats, PlayerData, KillFeed, TeamData } = currentReplayData || {};
  const owner = PlayerData?.find(p => p.IsReplayOwner);
  const skin = owner?.Cosmetics?.Character ? formatCosmeticShort(owner.Cosmetics.Character) : '?';
  const pickaxe = owner?.Cosmetics?.Pickaxe ? formatCosmeticShort(owner.Cosmetics.Pickaxe) : '?';
  const glider = owner?.Cosmetics?.Glider ? formatCosmeticShort(owner.Cosmetics.Glider) : '?';
  const backpack = owner?.Cosmetics?.Backpack ? formatCosmeticShort(owner.Cosmetics.Backpack) : '-';
  const ownerKills = owner?.Kills || 0;
  const ownerKnocks = KillFeed?.filter(k => k.FinisherOrDowner === owner?.Id && k.IsDowned).length || 0;
  const ownerFeed = owner?.Id ? (KillFeed || []).filter(k => k.FinisherOrDowner === owner.Id && !k.IsRevived) : [];

  // Replay Time Offsets
  const getKillfeedTimeOffsetSeconds = () => {
    return GameData?.WarmupCountdownEndTime
      || GameData?.AircraftStartTime
      || GameData?.SafeZonesStartTime
      || 0;
  };

  const getNormalizedEventTimeSeconds = (eventTimeSeconds) => {
    if (eventTimeSeconds === undefined || eventTimeSeconds === null) return 0;
    return Math.max(0, eventTimeSeconds - getKillfeedTimeOffsetSeconds());
  };

  // Owner death parsing
  const ownerDeathEntry = owner?.Id ? (KillFeed || [])
    .filter(k => k.PlayerId === owner.Id && !k.IsRevived)
    .sort((a, b) => (b.ReplicatedWorldTimeSecondsDouble || b.ReplicatedWorldTimeSeconds || 0) - (a.ReplicatedWorldTimeSecondsDouble || a.ReplicatedWorldTimeSeconds || 0))[0] : null;

  let ownerDeathText = null;
  if (owner && (owner.DeathTimeDouble !== null && owner.DeathTimeDouble !== undefined || owner.DeathTime !== null && owner.DeathTime !== undefined)) {
    const normalizedDeathTime = getNormalizedEventTimeSeconds(owner.DeathTimeDouble ?? owner.DeathTime);
    const timeStr = formatTime(normalizedDeathTime * 1000);
    
    if (ownerDeathEntry) {
      const killerId = ownerDeathEntry.FinisherOrDowner;
      const killerPlayer = killerId ? PlayerData?.find(p => p.Id === killerId) : null;
      let killerName = ownerDeathEntry.FinisherOrDownerName || 'unknown';
      let killerType = 'unknown';

      if (killerPlayer) {
        killerName = getPlayerDisplayName(killerPlayer);
        const pType = getPlayerType(killerPlayer);
        killerType = pType === 'Real' ? 'Real Player' : pType === 'BOT' ? 'BOT Player' : 'NPC';
      } else if (ownerDeathEntry.FinisherOrDownerIsBot) {
        killerType = 'BOT Player';
      } else {
        killerType = 'Real Player';
      }

      const dist = ownerDeathEntry.Distance ? ` | dist: ${(ownerDeathEntry.Distance / 100).toFixed(1)} m` : '';
      const weapon = extractWeaponFromTags(ownerDeathEntry.DeathTags);
      const weaponStr = weapon ? ` | via: ${weapon}` : '';

      ownerDeathText = `Killed at ${timeStr} by ${killerType} (${killerName})${dist}${weaponStr}`;
    } else {
      ownerDeathText = `Eliminated at ${timeStr}`;
    }
  }

  // Count breakdowns
  const totalPlayersCount = PlayerData?.length || 0;
  const realPlayersCount = PlayerData?.filter(p => !p.IsBot).length || 0;
  const botPlayersCount = PlayerData?.filter(p => p.IsBot && p.BotId && p.BotId.trim() !== '').length || 0;
  const npcPlayersCount = PlayerData?.filter(p => p.IsBot && (!p.BotId || p.BotId.trim() === '')).length || 0;
  const crownPlayersCount = PlayerData?.filter(p => p.HasCrown).length || 0;

  // Sorting
  const getDeathTime = (p) => p.DeathTimeDouble ?? p.DeathTime ?? Infinity;

  // 1. Team-Ranking
  const teamRankedPlayers = [...(PlayerData || [])]
    .filter(p => p.Placement > 0)
    .sort((a, b) => 
      a.Placement - b.Placement || 
      (a.TeamIndex ?? Infinity) - (b.TeamIndex ?? Infinity) || 
      getDeathTime(b) - getDeathTime(a) || 
      (b.Kills ?? 0) - (a.Kills ?? 0) || 
      (a.PlayerId || '').localeCompare(b.PlayerId || '')
    );

  const teamUnrankedAliveRealPlayers = [...(PlayerData || [])]
    .filter(p => !p.IsBot && (!p.Placement || p.Placement <= 0))
    .sort((a, b) => 
      (a.TeamIndex ?? Infinity) - (b.TeamIndex ?? Infinity) || 
      getDeathTime(b) - getDeathTime(a) || 
      (b.Kills ?? 0) - (a.Kills ?? 0) || 
      getPlayerDisplayName(a).localeCompare(getPlayerDisplayName(b))
    );

  const fullTeamRanking = [...teamUnrankedAliveRealPlayers, ...teamRankedPlayers];

  // 2. Individual Ranking
  const normalRankedPlayers = [...(PlayerData || [])]
    .filter(p => p.Placement > 0)
    .sort((a, b) => 
      a.Placement - b.Placement || 
      (b.Kills ?? 0) - (a.Kills ?? 0) || 
      (a.PlayerId || '').localeCompare(b.PlayerId || '')
    );

  const normalUnrankedAliveRealPlayers = [...(PlayerData || [])]
    .filter(p => !p.IsBot && (!p.Placement || p.Placement <= 0))
    .sort((a, b) => 
      (b.Kills ?? 0) - (a.Kills ?? 0) || 
      getPlayerDisplayName(a).localeCompare(getPlayerDisplayName(b))
    );

  const fullIndividualRanking = [...normalUnrankedAliveRealPlayers, ...normalRankedPlayers];

  const activeRanking = rankingTab === 'team' ? fullTeamRanking : fullIndividualRanking;

  return (
    <div className="app-container">
      
      {/* SIDEBAR */}
      <div className="sidebar">
        <div style={{ padding: '20px', borderBottom: '1px solid var(--panel-border)' }}>
          <h2 style={{ margin: '0 0 10px 0', fontSize: '1.1rem', color: 'var(--accent)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1px' }}>Replay Files</h2>
          <button 
            className="action-btn" 
            style={{ width: '100%', padding: '10px', background: 'linear-gradient(to right, #38bdf8, #8b5cf6)', color: 'white', border: 'none', borderRadius: '6px', cursor: parsingTarget ? 'not-allowed' : 'pointer', fontWeight: 'bold', opacity: parsingTarget ? 0.6 : 1, transition: 'all 0.2s' }}
            disabled={!!parsingTarget}
            onClick={() => reparse('all')}
          >
            {parsingTarget === 'all' ? 'Parsing All... ⏳' : 'Parse All Unparsed'}
          </button>
        </div>
        <div className="replay-list">
          {sourceReplays.map((sr, i) => {
            const isSelected = selectedReplay === sr.filename.replace('.replay', '.json');
            return (
              <div 
                key={i} 
                style={{ 
                  padding: '12px', 
                  marginBottom: '8px', 
                  background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.02)', 
                  border: isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontSize: '0.85rem', wordBreak: 'break-all', fontWeight: isSelected ? '600' : 'normal' }}>{sr.filename}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: sr.isParsed ? 'var(--success)' : 'var(--text-secondary)' }}>
                    {sr.isParsed ? '✅ Parsed' : '⏳ Unparsed'}
                  </span>
                  {sr.isParsed ? (
                    <button 
                      onClick={() => setSelectedReplay(sr.filename.replace('.replay', '.json'))}
                      style={{ padding: '4px 10px', background: 'var(--accent)', border: 'none', borderRadius: '4px', color: '#0b0f19', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 'bold', transition: 'all 0.2s' }}
                    >
                      View
                    </button>
                  ) : (
                    <button 
                      disabled={!!parsingTarget}
                      onClick={() => reparse(sr.filename)}
                      style={{ padding: '4px 10px', background: 'transparent', border: '1px solid var(--accent)', borderRadius: '4px', color: 'var(--accent)', cursor: parsingTarget ? 'not-allowed' : 'pointer', fontSize: '0.75rem', opacity: parsingTarget ? 0.5 : 1 }}
                    >
                      {parsingTarget === sr.filename ? '⏳...' : 'Parse'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          {sourceReplays.length === 0 && <div style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '20px' }}>No Replays found.</div>}
        </div>
      </div>
 
      {/* MAIN CONTENT */}
      <div className="main-content">
        <header>
          <div>
            <h1 style={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>Play.Parse.Analyze.Repeat</h1>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '2px' }}>Fortnite Replay Parser & Dashboard</div>
          </div>
          <div className="status-badge">
            <div className="status-indicator" style={{ background: status.isLive ? 'var(--danger)' : 'var(--success)', boxShadow: `0 0 10px ${status.isLive ? 'var(--danger)' : 'var(--success)'}` }}></div>
            {status.isLive ? `Live Match in Progress (${status.durationMinutes}m)` : 'Folder Monitor Active'}
          </div>
        </header>

        {!currentReplayData ? (
          <div className="glass-panel no-data" style={{ padding: '60px 40px' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '15px' }}>📊</div>
            <h3>No Replay Selected</h3>
            <p style={{ marginTop: '8px', fontSize: '0.9rem' }}>Select a parsed replay from the sidebar list to load full stats, or play a game to watch live.</p>
          </div>
        ) : (
          <>
            <div className="dashboard-grid">
              
              {/* MATCH OVERVIEW */}
              <div className="glass-panel">
                <h2 className="section-title">
                  <span>Match Details</span>
                </h2>
                <div className="stat-grid">
                  <div className="stat-box full-width">
                    <div className="stat-label">File Name</div>
                    <div className="stat-value" style={{ fontSize: '0.85rem', wordBreak: 'break-all', fontFamily: 'JetBrains Mono, monospace' }}>{selectedReplay?.replace('.json', '')}</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-label">Match Duration</div>
                    <div className="stat-value">{Info ? formatTime(Info.LengthInMs) : '--:--'}</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-label">Game Mode</div>
                    <div className="stat-value" style={{ fontSize: '1rem' }}>
                      {getGameMode(GameData?.CurrentPlaylist)}
                      {getPlayersPerTeam(GameData?.CurrentPlaylist) > 0 && ` (${getPlayersPerTeam(GameData?.CurrentPlaylist)}v${getPlayersPerTeam(GameData?.CurrentPlaylist)})`}
                    </div>
                  </div>
                  <div className="stat-box full-width">
                    <div className="stat-label">Lobby Players ({totalPlayersCount} total)</div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '6px' }}>
                      <span className="type-badge real">{realPlayersCount} Real</span>
                      <span className="type-badge bot">{botPlayersCount} BOTs</span>
                      <span className="type-badge npc">{npcPlayersCount} NPCs</span>
                      {crownPlayersCount > 0 && <span className="crown-badge">👑 {crownPlayersCount} Crowns</span>}
                    </div>
                  </div>
                </div>
              </div>

              {/* OWNER STATS */}
              <div className="glass-panel">
                <h2 className="section-title">
                  <span>Replay Owner Performance</span>
                </h2>
                {owner ? (
                  <div className="stat-grid">
                    <div className="stat-box">
                      <div className="stat-label">Player Profile</div>
                      <div className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '1.05rem' }}>
                        {getPlayerDisplayName(owner)}
                        {owner.HasCrown && <span className="crown-icon">👑</span>}
                        <span className="owner-badge">Owner</span>
                      </div>
                      <div className="stat-subtext" style={{ fontSize: '0.72rem', fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-all' }}>{owner.EpicId || owner.PlatformUniqueNetId || 'No Epic ID'}</div>
                    </div>
                    
                    <div className="stat-box">
                      <div className="stat-label">Match Rank Placement</div>
                      <div className="stat-value" style={{ color: owner.Placement === 1 ? 'var(--warning)' : owner.Placement === 2 ? '#94a3b8' : 'var(--accent)' }}>
                        #{owner.Placement ? owner.Placement.toString().padStart(2, '0') : '??'}
                      </div>
                    </div>
                    
                    <div className="stat-box full-width" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div className="stat-label">Combat & General Stats</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', textAlign: 'center' }}>
                        <div style={{ background: 'rgba(0,0,0,0.15)', padding: '6px', borderRadius: '4px' }}>
                          <div className="stat-label" style={{ fontSize: '0.65rem' }}>Kills</div>
                          <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>{ownerKills}</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.15)', padding: '6px', borderRadius: '4px' }}>
                          <div className="stat-label" style={{ fontSize: '0.65rem' }}>Knocks</div>
                          <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>{ownerKnocks}</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.15)', padding: '6px', borderRadius: '4px' }}>
                          <div className="stat-label" style={{ fontSize: '0.65rem' }}>Assists</div>
                          <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>{Stats?.Assists ?? 0}</div>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.15)', padding: '6px', borderRadius: '4px' }}>
                          <div className="stat-label" style={{ fontSize: '0.65rem' }}>Accuracy</div>
                          <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>
                            {Stats?.Accuracy ? (Stats.Accuracy * 100).toFixed(1) + '%' : '0%'}
                          </div>
                        </div>
                      </div>
                      
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginTop: '4px' }}>
                        <div style={{ background: 'rgba(0,0,0,0.15)', padding: '6px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Damage Given:</span>
                          <span style={{ fontWeight: 'bold', color: 'var(--accent)' }}>{Stats?.DamageToPlayers ?? 0}</span>
                        </div>
                        <div style={{ background: 'rgba(0,0,0,0.15)', padding: '6px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Damage Taken:</span>
                          <span style={{ fontWeight: 'bold', color: 'var(--danger)' }}>{Stats?.DamageTaken ?? 0}</span>
                        </div>
                      </div>
                    </div>

                    <div className="stat-box full-width" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                      <div>
                        <div className="stat-label" style={{ fontSize: '0.65rem' }}>Structures Dmg</div>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{Stats?.DamageToStructures ?? 0}</div>
                      </div>
                      <div>
                        <div className="stat-label" style={{ fontSize: '0.65rem' }}>Mats (Gath / Used)</div>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{Stats?.MaterialsGathered ?? 0} / {Stats?.MaterialsUsed ?? 0}</div>
                      </div>
                      <div>
                        <div className="stat-label" style={{ fontSize: '0.65rem' }}>Travel Distance</div>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{Stats?.TotalTraveled ? (Stats.TotalTraveled / 100).toFixed(0) + ' m' : '0 m'}</div>
                      </div>
                    </div>

                    {ownerDeathText && (
                      <div className="stat-box full-width" style={{ background: 'rgba(239, 68, 68, 0.08)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
                        <div className="stat-label" style={{ color: 'var(--danger)', fontWeight: 'bold' }}>Death Details</div>
                        <div style={{ fontSize: '0.8rem', marginTop: '2px', color: '#fca5a5', fontFamily: 'JetBrains Mono, monospace' }}>{ownerDeathText}</div>
                      </div>
                    )}

                    <div className="stat-box full-width" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div className="stat-label">Cosmetics Equip</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px', fontSize: '0.78rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Skin:</span>
                          <span style={{ fontWeight: 'bold', color: '#fff' }}>{skin}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Pickaxe:</span>
                          <span style={{ fontWeight: 'bold', color: '#fff' }}>{pickaxe}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Glider:</span>
                          <span style={{ fontWeight: 'bold', color: '#fff' }}>{glider}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: 'var(--text-secondary)' }}>Backpack:</span>
                          <span style={{ fontWeight: 'bold', color: '#fff' }}>{backpack}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="no-data" style={{ padding: '20px 10px' }}>Owner details could not be found.</div>
                )}
              </div>
            </div>

            <div className="dashboard-grid">
              
              {/* KILLFEED */}
              <div className="glass-panel">
                <h2 className="section-title">
                  <span>Owner Killfeed Logs</span>
                </h2>
                {ownerFeed.length > 0 ? (
                  <div className="killfeed-list">
                    {ownerFeed.map((k, i) => {
                      const victim = PlayerData?.find(p => p.Id === k.PlayerId);
                      const victimName = getPlayerDisplayName(victim || { PlayerNameCustomOverride: k.PlayerName });
                      const victimRank = victim?.Placement ? `Rank: #${victim.Placement}` : 'Rank: ??';
                      const normalizedTime = getNormalizedEventTimeSeconds(k.ReplicatedWorldTimeSecondsDouble ?? k.ReplicatedWorldTimeSeconds ?? 0);
                      const timeStr = formatTime(normalizedTime * 1000);
                      const dist = k.Distance ? (k.Distance / 100).toFixed(1) + ' m' : '--';
                      const weapon = extractWeaponFromTags(k.DeathTags) || 'Weapon';
                      const feedTag = getKillfeedTag(victim, k);

                      return (
                        <div key={i} className={`kill-entry ${k.IsDowned ? 'knock' : 'kill'}`}>
                          <div>
                            <span className="kill-time">[{timeStr}]</span>
                            <span className={`kill-action-badge ${k.IsDowned ? 'knocked' : 'killed'}`}>
                              {k.IsDowned ? 'knocked' : 'killed!'}
                            </span>
                            <span className={`type-badge ${feedTag.toLowerCase()}`} style={{ marginRight: '8px', transform: 'scale(0.85)', transformOrigin: 'left center' }}>
                              {feedTag}
                            </span>
                            <span style={{ fontWeight: '600' }}>{victimName}</span>
                            {victim?.HasCrown && <span className="crown-icon">👑</span>}
                          </div>
                          <div className="kill-weapon">
                            <span style={{ color: 'var(--text-secondary)' }}>{victimRank}</span> | {dist} | <span style={{ color: '#fff', fontWeight: '500' }}>{weapon}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="no-data" style={{ padding: '40px 10px' }}>No eliminations or knocks recorded for the owner in this match.</div>
                )}
              </div>

              {/* RANKINGS */}
              <div className="glass-panel">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h2 className="section-title" style={{ margin: 0, border: 'none', padding: 0 }}>
                    <span>Rankings Overview</span>
                  </h2>
                  <div className="tab-container">
                    <button 
                      onClick={() => setRankingTab('team')} 
                      className={`tab-btn ${rankingTab === 'team' ? 'active' : ''}`}
                    >
                      Team-Ranking
                    </button>
                    <button 
                      onClick={() => setRankingTab('individual')} 
                      className={`tab-btn ${rankingTab === 'individual' ? 'active' : ''}`}
                    >
                      Ranking (Indiv)
                    </button>
                  </div>
                </div>

                <div className="table-wrapper">
                  <table className="ranking-table">
                    <thead>
                      <tr>
                        <th style={{ width: '60px' }}>Rank</th>
                        <th style={{ width: '60px' }}>Team</th>
                        <th>Player</th>
                        <th style={{ width: '80px' }}>Type</th>
                        <th style={{ width: '60px' }}>Kills</th>
                        <th style={{ width: '90px' }}>Level</th>
                        <th style={{ width: '70px' }}>Platform</th>
                        <th>Skin Equiped</th>
                        {rankingTab === 'team' && <th style={{ width: '60px' }}>Reboots</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {activeRanking.map((p, i) => {
                        const isTeammate = owner && p.TeamIndex === owner.TeamIndex && !p.IsReplayOwner;
                        const rowClass = p.IsReplayOwner ? 'owner-row' : isTeammate ? 'teammate-row' : '';
                        const pType = getPlayerType(p);
                        const displayLevel = p.Level !== null && p.Level !== undefined ? p.Level : '???';
                        const displaySeasonLevel = p.SeasonLevelUIDisplay !== null && p.SeasonLevelUIDisplay !== undefined ? p.SeasonLevelUIDisplay : '???';

                        return (
                          <React.Fragment key={i}>
                            <tr className={rowClass}>
                              <td style={{ fontWeight: 'bold', color: p.Placement === 1 ? 'var(--warning)' : p.Placement === 2 ? '#94a3b8' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {p.Id !== null && p.Id !== undefined && (
                                  <button onClick={() => toggleExpand(p.Id)} className="expand-btn" style={{ fontSize: '0.8rem', padding: '0 4px', lineHeight: 1 }}>
                                    {expandedPlayers[p.Id] ? '−' : '+'}
                                  </button>
                                )}
                                {p.Placement ? `#${p.Placement.toString().padStart(2, '0')}` : '#??'}
                              </td>
                              <td>T{p.TeamIndex !== null && p.TeamIndex !== undefined ? p.TeamIndex.toString().padStart(2, '0') : '??'}</td>
                              <td style={{ color: p.IsReplayOwner ? 'var(--accent)' : '#fff', fontWeight: (p.IsReplayOwner || isTeammate) ? 'bold' : 'normal' }}>
                                {p.IsReplayOwner && <span style={{ color: 'var(--accent)', marginRight: '4px' }}>★</span>}
                                {isTeammate && <span style={{ color: 'var(--purple)', marginRight: '4px' }}>•</span>}
                                {getPlayerDisplayName(p)}
                                {p.HasCrown && <span className="crown-icon">👑</span>}
                                {p.IsReplayOwner && <span style={{ fontSize: '0.65rem', marginLeft: '6px', opacity: 0.8 }} className="owner-badge">Owner</span>}
                              </td>
                              <td>
                                <span className={`type-badge ${pType.toLowerCase()}`}>
                                  {pType}
                                </span>
                              </td>
                              <td style={{ fontWeight: 'bold' }}>{p.Kills ?? 0}</td>
                              <td>{displayLevel} ({displaySeasonLevel})</td>
                              <td>{p.Platform || '--'}</td>
                              <td style={{ fontSize: '0.72rem', color: varColors(pType) }}>
                                {p.Cosmetics?.Character ? formatCosmeticShort(p.Cosmetics.Character) : '-'}
                              </td>
                              {rankingTab === 'team' && (
                                <td style={{ textAlign: 'center', fontWeight: 'bold', color: p.RebootCounter > 0 ? 'var(--success)' : 'var(--text-secondary)' }}>
                                  {p.RebootCounter ?? 0}
                                </td>
                              )}
                            </tr>
                            {expandedPlayers[p.Id] && (
                              <tr className="details-row">
                                <td colSpan={rankingTab === 'team' ? 9 : 8}>
                                  <div className="player-details-expanded">
                                    {/* Death Info */}
                                    {(() => {
                                      const pDeathEntry = p.Id !== null ? (KillFeed || [])
                                        .filter(k => k.PlayerId === p.Id && !k.IsRevived)
                                        .sort((a, b) => (b.ReplicatedWorldTimeSecondsDouble || b.ReplicatedWorldTimeSeconds || 0) - (a.ReplicatedWorldTimeSecondsDouble || a.ReplicatedWorldTimeSeconds || 0))[0] : null;

                                      let pDeathText = null;
                                      const hasPDeathTime = p.DeathTimeDouble !== null && p.DeathTimeDouble !== undefined || p.DeathTime !== null && p.DeathTime !== undefined;
                                      
                                      if (hasPDeathTime || pDeathEntry) {
                                        const normalizedTime = getNormalizedEventTimeSeconds(p.DeathTimeDouble ?? p.DeathTime);
                                        const timeStr = formatTime(normalizedTime * 1000);
                                        
                                        if (pDeathEntry) {
                                          const killerId = pDeathEntry.FinisherOrDowner;
                                          const killerPlayer = killerId ? PlayerData?.find(pl => pl.Id === killerId) : null;
                                          let killerName = pDeathEntry.FinisherOrDownerName || 'unknown';
                                          let killerType = 'unknown';

                                          if (killerPlayer) {
                                            killerName = getPlayerDisplayName(killerPlayer);
                                            const typeLabel = getPlayerType(killerPlayer);
                                            killerType = typeLabel === 'Real' ? 'Real Player' : typeLabel === 'BOT' ? 'BOT Player' : 'NPC';
                                          } else if (pDeathEntry.FinisherOrDownerIsBot) {
                                            killerType = 'BOT Player';
                                          } else {
                                            killerType = 'Real Player';
                                          }

                                          const dist = pDeathEntry.Distance ? ` | dist: ${(pDeathEntry.Distance / 100).toFixed(1)} m` : '';
                                          const weapon = extractWeaponFromTags(pDeathEntry.DeathTags);
                                          const weaponStr = weapon ? ` | via: ${weapon}` : '';

                                          pDeathText = `Killed at ${timeStr} by ${killerType} (${killerName})${dist}${weaponStr}`;
                                        } else {
                                          pDeathText = `Eliminated at ${timeStr}`;
                                        }
                                      } else {
                                        pDeathText = 'Alive';
                                      }

                                      const isAlive = pDeathText === 'Alive';

                                      return (
                                        <div className={`expanded-death-info ${isAlive ? 'alive' : ''}`}>
                                          <strong>[Death]</strong> {pDeathText}
                                        </div>
                                      );
                                    })()}

                                    {/* Killfeed */}
                                    {(() => {
                                      const pFeed = p.Id !== null ? (KillFeed || []).filter(k => k.FinisherOrDowner === p.Id && !k.IsRevived) : [];
                                      if (pFeed.length === 0) return null;

                                      return (
                                        <div>
                                          <div className="expanded-killfeed-title">[Killfeed]</div>
                                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {pFeed.map((k, idx) => {
                                              const victim = PlayerData?.find(pl => pl.Id === k.PlayerId);
                                              const victimName = getPlayerDisplayName(victim || { PlayerNameCustomOverride: k.PlayerName });
                                              const victimRank = victim?.Placement ? `Rank: #${victim.Placement}` : 'Rank: ??';
                                              const normalizedTime = getNormalizedEventTimeSeconds(k.ReplicatedWorldTimeSecondsDouble ?? k.ReplicatedWorldTimeSeconds ?? 0);
                                              const timeStr = formatTime(normalizedTime * 1000);
                                              const dist = k.Distance ? (k.Distance / 100).toFixed(1) + ' m' : '--';
                                              const weapon = extractWeaponFromTags(k.DeathTags) || 'Weapon';
                                              const feedTag = getKillfeedTag(victim, k);

                                              return (
                                                <div key={idx} className={`kill-entry ${k.IsDowned ? 'knock' : 'kill'}`} style={{ padding: '6px 12px', fontSize: '0.78rem' }}>
                                                  <div>
                                                    <span className="kill-time">[{timeStr}]</span>
                                                    <span className={`kill-action-badge ${k.IsDowned ? 'knocked' : 'killed'}`} style={{ fontSize: '0.65rem' }}>
                                                      {k.IsDowned ? 'knocked' : 'killed!'}
                                                    </span>
                                                    <span className={`type-badge ${feedTag.toLowerCase()}`} style={{ marginRight: '8px', transform: 'scale(0.8)', transformOrigin: 'left center' }}>
                                                      {feedTag}
                                                    </span>
                                                    <span style={{ fontWeight: '600' }}>{victimName}</span>
                                                    {victim?.HasCrown && <span className="crown-icon">👑</span>}
                                                  </div>
                                                  <div className="kill-weapon">
                                                    <span style={{ color: 'var(--text-secondary)' }}>{victimRank}</span> | {dist} | <span style={{ color: '#fff', fontWeight: '500' }}>{weapon}</span>
                                                  </div>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })()}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {activeRanking.length === 0 && (
                        <tr>
                          <td colSpan={rankingTab === 'team' ? 9 : 8} style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>
                            No player records found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Helper colors for skins depending on type
const varColors = (type) => {
  if (type === 'Real') return '#e2e8f0';
  if (type === 'BOT') return '#f59e0b';
  return '#8b5cf6';
};

export default App;
