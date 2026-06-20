import { create } from 'zustand';

const API_BASE = 'http://localhost:5142/api';

export const useStore = create((set, get) => ({
  replays: [],
  sourceReplays: [],
  status: { isLive: false, durationMinutes: 0 },
  selectedReplay: null,

  setSelectedReplay: (filename) => set({ selectedReplay: filename }),

  fetchData: async () => {
    try {
      const [replaysRes, sourceRes, statusRes] = await Promise.all([
        fetch(`${API_BASE}/replays`).catch(() => null),
        fetch(`${API_BASE}/source-replays`).catch(() => null),
        fetch(`${API_BASE}/status`).catch(() => null)
      ]);

      const replays = replaysRes ? await replaysRes.json() : [];
      const sourceReplays = sourceRes ? await sourceRes.json() : [];
      const status = statusRes ? await statusRes.json() : { isLive: false, durationMinutes: 0 };

      // Sort parsed replays by filename descending (newest game first)
      replays.sort((a, b) => b.filename.localeCompare(a.filename));

      set((state) => {
        let newSelected = state.selectedReplay;

        // Auto-select latest game if none selected, or if a newer game finished parsing
        if (replays.length > 0) {
          if (!newSelected) {
            newSelected = replays[0].filename;
          } else {
            // Check if the newest available game is newer than what we currently have selected
            const currentSelectedIndex = replays.findIndex(r => r.filename === newSelected);
            if (currentSelectedIndex > 0) {
              // Wait, if a new replay was just parsed, it will be at index 0. We should select it!
              newSelected = replays[0].filename;
            }
          }
        }

        // Only update state if things actually changed to avoid unnecessary re-renders
        return {
          replays,
          sourceReplays,
          status,
          selectedReplay: newSelected
        };
      });
    } catch (err) {
      console.error("Error fetching data:", err);
    }
  },

  reparse: async (target) => {
    try {
      await fetch(`${API_BASE}/reparse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target })
      });
      // Force immediate refresh
      get().fetchData();
    } catch (err) {
      console.error("Failed to trigger reparse:", err);
    }
  }
}));
