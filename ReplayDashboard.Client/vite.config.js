import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

export default defineConfig({
  server: {
    port: 5142,
    strictPort: true
  },
  plugins: [
    react(),
    {
      name: 'replay-watcher-plugin',
      configureServer(server) {
        const parsedDir = path.resolve(__dirname, '../REPLAYS/PARSED');
        
        // Spawn ReplayWatcher
        const watcherExePath = path.resolve(__dirname, '../publish/ReplayWatcher/ReplayWatcher.exe');
        let watcherProcess = null;
        
        if (fs.existsSync(watcherExePath)) {
            console.log('[ReplayDashboard] Starting ReplayWatcher.exe in background...');
            watcherProcess = spawn(watcherExePath, ['--dir', path.resolve(__dirname, '../REPLAYS'), '--process-existing'], {
                stdio: 'inherit',
                detached: false
            });
            
            watcherProcess.on('error', (err) => {
                console.error('[ReplayDashboard] Failed to start ReplayWatcher:', err);
            });
        } else {
            console.warn('[ReplayDashboard] ReplayWatcher.exe not found at', watcherExePath);
        }

        // Cleanup on Vite exit
        process.on('exit', () => {
            if (watcherProcess) watcherProcess.kill();
        });

        // API Endpoint
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/replays') {
            if (!fs.existsSync(parsedDir)) {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify([]));
                return;
            }
            
            const files = fs.readdirSync(parsedDir)
                .filter(file => file.endsWith('.json'))
                .map(file => {
                    const fullPath = path.join(parsedDir, file);
                    const stats = fs.statSync(fullPath);
                    return {
                        filename: file,
                        mtime: stats.mtimeMs
                    };
                })
                .sort((a, b) => b.mtime - a.mtime); // Newest first

            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(files));
            return;
          }
          
          if (req.url.startsWith('/api/replays/')) {
            const fileName = decodeURIComponent(req.url.replace('/api/replays/', ''));
            const filePath = path.join(parsedDir, fileName);
            if (fs.existsSync(filePath)) {
                res.setHeader('Content-Type', 'application/json');
                res.end(fs.readFileSync(filePath));
                return;
            } else {
                res.statusCode = 404;
                res.end('Not found');
                return;
            }
          }
          
          next();
        });
      }
    }
  ]
})
