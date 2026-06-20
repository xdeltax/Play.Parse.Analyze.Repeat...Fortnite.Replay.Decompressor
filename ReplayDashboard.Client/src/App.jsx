import React, { useState, useEffect } from 'react';
import { useStore } from './store';
import './index.css';

const App = () => {
  const { replays, sourceReplays, status, selectedReplay, fetchData, setSelectedReplay, reparse } = useStore();
  const [currentReplayData, setCurrentReplayData] = useState(null);

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
    return playlist;
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

  const { Info, GameData, Stats, PlayerData, KillFeed, TeamStats } = currentReplayData || {};
  const owner = PlayerData?.find(p => p.IsReplayOwner);
  const ownerKills = owner?.Kills || 0;
  const ownerKnocks = KillFeed?.filter(k => k.FinisherOrDowner === owner?.Id && k.IsDowned).length || 0;
  const ownerFeed = owner?.Id ? (KillFeed || []).filter(k => k.FinisherOrDowner === owner.Id && !k.IsRevived) : [];
  const teamRanking = [...(PlayerData || [])].filter(p => p.Placement > 0)
    .sort((a, b) => a.Placement - b.Placement || (a.TeamIndex || 99) - (b.TeamIndex || 99) || (b.DeathTimeDouble || b.DeathTime || 9999) - (a.DeathTimeDouble || a.DeathTime || 9999));

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'row', height: '100vh', overflow: 'hidden' }}>
      
      {/* SIDEBAR */}
      <div className="sidebar" style={{ width: '350px', background: 'rgba(15, 23, 42, 0.9)', borderRight: '1px solid rgba(255, 255, 255, 0.1)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '20px', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
          <h2 style={{ margin: '0 0 10px 0', fontSize: '1.2rem', color: 'var(--accent)' }}>Replay List</h2>
          <button 
            className="action-btn" 
            style={{ width: '100%', padding: '10px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
            onClick={() => reparse('all')}
          >
            Parse All Unparsed
          </button>
        </div>
        <div className="replay-list" style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
          {sourceReplays.map((sr, i) => {
            const isSelected = selectedReplay === sr.filename.replace('.replay', '.json');
            return (
              <div 
                key={i} 
                style={{ 
                  padding: '12px', 
                  marginBottom: '8px', 
                  background: isSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.03)', 
                  border: isSelected ? '1px solid var(--primary)' : '1px solid transparent',
                  borderRadius: '6px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                  transition: 'all 0.2s'
                }}
              >
                <div style={{ fontSize: '0.9rem', wordBreak: 'break-all' }}>{sr.filename}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.8rem', color: sr.isParsed ? 'var(--success)' : 'var(--text-secondary)' }}>
                    {sr.isParsed ? '✅ Parsed' : '⏳ Unparsed'}
                  </span>
                  {sr.isParsed ? (
                    <button 
                      onClick={() => setSelectedReplay(sr.filename.replace('.replay', '.json'))}
                      style={{ padding: '4px 8px', background: 'var(--accent)', border: 'none', borderRadius: '4px', color: '#0f172a', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold' }}
                    >
                      View
                    </button>
                  ) : (
                    <button 
                      onClick={() => reparse(sr.filename)}
                      style={{ padding: '4px 8px', background: 'transparent', border: '1px solid var(--primary)', borderRadius: '4px', color: 'var(--primary)', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      Parse
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
      <div className="main-content" style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
        <header style={{ marginBottom: '30px' }}>
          <h1>Fortnite Replay Dashboard</h1>
          <div className="status-badge" style={{ background: status.isLive ? 'rgba(239, 68, 68, 0.2)' : 'rgba(56, 189, 248, 0.1)', border: `1px solid ${status.isLive ? 'var(--danger)' : 'var(--primary)'}` }}>
            <div className="status-indicator" style={{ background: status.isLive ? 'var(--danger)' : 'var(--primary)', boxShadow: `0 0 10px ${status.isLive ? 'var(--danger)' : 'var(--primary)'}` }}></div>
            {status.isLive ? `🔴 Live Game in Progress (since ${status.durationMinutes} min)` : 'Monitoring Folder...'}
          </div>
        </header>

        {!currentReplayData ? (
          <div className="glass-panel no-data" style={{ padding: '40px', textAlign: 'center' }}>
            Select a parsed replay from the sidebar to view its stats, or play a new game.
          </div>
        ) : (
          <>
            <div className="dashboard-grid">
              {/* MATCH OVERVIEW */}
              <div className="glass-panel">
                <h2 className="section-title">Match Overview</h2>
                <div className="stat-grid">
                  <div className="stat-box">
                    <div className="stat-label">File</div>
                    <div className="stat-value" style={{fontSize: '0.9rem'}}>{selectedReplay?.replace('.json', '')}</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-label">Duration</div>
                    <div className="stat-value">{Info ? formatTime(Info.LengthInMs) : '--:--'}</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-label">Mode</div>
                    <div className="stat-value">{getGameMode(GameData?.CurrentPlaylist)} {getPlayersPerTeam(GameData?.CurrentPlaylist) > 0 ? `(${getPlayersPerTeam(GameData?.CurrentPlaylist)}v${getPlayersPerTeam(GameData?.CurrentPlaylist)})` : ''}</div>
                  </div>
                  <div className="stat-box">
                    <div className="stat-label">Players</div>
                    <div className="stat-value">{TeamStats?.TotalPlayers || PlayerData?.length || 0}</div>
                  </div>
                </div>
              </div>

              {/* OWNER STATS */}
              <div className="glass-panel">
                <h2 className="section-title">Owner Performance</h2>
                {owner ? (
                  <div className="stat-grid">
                    <div className="stat-box">
                        <div className="stat-label">Player</div>
                        <div className="stat-value">{owner.PlayerName || 'Unknown'} {owner.HasCrown && '👑'}</div>
                    </div>
                    <div className="stat-box">
                        <div className="stat-label">Placement</div>
                        <div className="stat-value">#{owner.Placement || '?'}</div>
                    </div>
                    <div className="stat-box">
                        <div className="stat-label">Elims / Knocks</div>
                        <div className="stat-value">{ownerKills} / {ownerKnocks}</div>
                    </div>
                    <div className="stat-box">
                        <div className="stat-label">Damage (Given/Recv)</div>
                        <div className="stat-value">{Stats?.DamageToPlayers || 0} / {Stats?.DamageTaken || 0}</div>
                    </div>
                  </div>
                ) : (
                  <div className="no-data" style={{padding: '1rem'}}>Owner data not found in this replay.</div>
                )}
              </div>
            </div>

            <div className="dashboard-grid">
              {/* KILLFEED */}
              <div className="glass-panel">
                <h2 className="section-title">Owner Killfeed</h2>
                {ownerFeed.length > 0 ? (
                  <div className="killfeed-list">
                    {ownerFeed.map((k, i) => {
                      const victim = PlayerData?.find(p => p.Id === k.PlayerId);
                      const victimName = victim ? (victim.PlayerName || (victim.IsBot ? 'BOT' : 'Unknown')) : (k.PlayerName || 'Unknown');
                      const timeStr = k.ReplicatedWorldTimeSecondsDouble ? formatTime(k.ReplicatedWorldTimeSecondsDouble * 1000) : '--:--';
                      const dist = k.Distance ? (k.Distance / 100).toFixed(1) + 'm' : '';
                      
                      let weapon = '';
                      const tags = k.DeathTags || [];
                      const ranged = tags.find(t => t.toLowerCase().includes('weapon.ranged.'));
                      if (ranged) {
                        const parts = ranged.split('.');
                        if (parts.length >= 4) weapon = `${parts[2]}: ${parts[3]}`;
                        else weapon = parts[2] || '';
                      } else if (tags.some(t => t.toLowerCase().includes('outsidesafezone'))) {
                        weapon = 'Storm';
                      } else if (tags.some(t => t.toLowerCase().includes('fall'))) {
                        weapon = 'Fall Damage';
                      } else {
                        weapon = tags.find(t => t.toLowerCase().includes('weapon.'))?.split('.').pop() || 'Unknown';
                      }

                      return (
                        <div key={i} className={`kill-entry ${k.IsDowned ? 'knock' : 'kill'}`}>
                          <div>
                            <span className="kill-time">[{timeStr}]</span>
                            <span className={k.IsDowned ? 'kill-knock' : 'kill-elim'}>{k.IsDowned ? 'KNOCKED' : 'ELIMINATED'}</span>
                            <span style={{marginLeft: '0.5rem'}}>{victimName} {victim?.HasCrown && '👑'}</span>
                          </div>
                          <div className="kill-weapon">{dist} | {weapon}</div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="no-data" style={{padding: '2rem'}}>No eliminations or knocks recorded.</div>
                )}
              </div>

              {/* TEAM RANKING */}
              <div className="glass-panel" style={{ overflowX: 'auto' }}>
                <h2 className="section-title">Team Ranking (Top Players)</h2>
                <table className="ranking-table">
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Team</th>
                      <th>Player</th>
                      <th>Kills</th>
                      <th>Level</th>
                      <th>Platform</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamRanking.slice(0, 20).map((p, i) => (
                      <tr key={i} className={p.IsReplayOwner ? 'owner-row' : ''}>
                        <td>#{p.Placement || '??'}</td>
                        <td>T{p.TeamIndex !== null ? p.TeamIndex.toString().padStart(2, '0') : '??'}</td>
                        <td>
                          {p.IsReplayOwner && <span style={{color: 'var(--accent)', marginRight: '4px'}}>★</span>}
                          {p.PlayerName || (p.IsBot ? 'BOT' : 'Unknown')}
                          {p.HasCrown && <span className="crown-icon">👑</span>}
                        </td>
                        <td>{p.Kills || 0}</td>
                        <td>{p.Level || '??'}</td>
                        <td>{p.Platform || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default App;
