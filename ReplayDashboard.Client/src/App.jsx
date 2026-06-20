import React, { useState, useEffect } from 'react';
import './index.css';

const App = () => {
  const [replays, setReplays] = useState([]);
  const [currentReplayData, setCurrentReplayData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Poll for new replays
  useEffect(() => {
    const fetchReplays = async () => {
      try {
        const res = await fetch('/api/replays');
        const data = await res.json();
        
        // Check if list changed
        setReplays(prev => {
          if (JSON.stringify(prev) !== JSON.stringify(data)) {
            return data;
          }
          return prev;
        });
        setIsLoading(false);
      } catch (err) {
        console.error('Failed to fetch replays:', err);
      }
    };

    fetchReplays();
    const interval = setInterval(fetchReplays, 2000);
    return () => clearInterval(interval);
  }, []);

  // Fetch data for the newest replay automatically
  useEffect(() => {
    if (replays.length > 0) {
      const newest = replays[0];
      fetch(`/api/replays/${encodeURIComponent(newest.filename)}`)
        .then(res => res.json())
        .then(data => setCurrentReplayData(data))
        .catch(err => console.error('Failed to load replay data:', err));
    }
  }, [replays]);

  if (isLoading) {
    return (
      <div className="app-container">
        <header>
          <h1>Fortnite Replay Dashboard</h1>
          <div className="status-badge">
            <div className="status-indicator" style={{ background: 'var(--warning)', boxShadow: '0 0 10px var(--warning)' }}></div>
            Connecting...
          </div>
        </header>
        <div className="no-data">Waiting for ReplayWatcher...</div>
      </div>
    );
  }

  if (!currentReplayData) {
    return (
      <div className="app-container">
        <header>
          <h1>Fortnite Replay Dashboard</h1>
          <div className="status-badge">
            <div className="status-indicator"></div>
            Listening for Matches
          </div>
        </header>
        <div className="no-data">No parsed replays found in REPLAYS/PARSED. Play a match to see data here!</div>
      </div>
    );
  }

  const { Info, Header, GameData, Stats, PlayerData, KillFeed, TeamStats } = currentReplayData;

  // Helpers
  const formatTime = (ms) => {
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

  const owner = PlayerData?.find(p => p.IsReplayOwner);
  const ownerKills = owner?.Kills || 0;
  const ownerKnocks = KillFeed?.filter(k => k.FinisherOrDowner === owner?.Id && k.IsDowned).length || 0;

  // Process Killfeed
  const ownerFeed = owner?.Id 
    ? (KillFeed || []).filter(k => k.FinisherOrDowner === owner.Id && !k.IsRevived)
    : [];

  // Ranking processing
  const realPlayers = PlayerData?.filter(p => !p.IsBot) || [];
  const teamRanking = [...PlayerData].filter(p => p.Placement > 0)
    .sort((a, b) => a.Placement - b.Placement || (a.TeamIndex || 99) - (b.TeamIndex || 99) || (b.DeathTimeDouble || b.DeathTime || 9999) - (a.DeathTimeDouble || a.DeathTime || 9999));

  return (
    <div className="app-container">
      <header>
        <h1>Fortnite Replay Dashboard</h1>
        <div className="status-badge">
          <div className="status-indicator"></div>
          Monitoring Live
        </div>
      </header>

      <div className="dashboard-grid">
        {/* MATCH OVERVIEW */}
        <div className="glass-panel">
          <h2 className="section-title">Match Overview</h2>
          <div className="stat-grid">
            <div className="stat-box">
              <div className="stat-label">File</div>
              <div className="stat-value" style={{fontSize: '1rem'}}>{replays[0]?.filename.replace('.json', '')}</div>
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
                
                // Parse weapon from tags
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
    </div>
  );
}

export default App;
