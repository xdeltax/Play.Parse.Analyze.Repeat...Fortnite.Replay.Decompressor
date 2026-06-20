using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

public sealed class HttpServer : IDisposable
{
    private readonly HttpListener _listener;
    private readonly IReadOnlyList<string> _replayDirectories;
    private readonly IReadOnlyList<string> _parsedDirs;
    private readonly string _wwwroot;
    private readonly Action<string> _reparseAction;
    private readonly Func<DateTime?> _pendingStatusFunc;

    public HttpServer(IReadOnlyList<string> replayDirectories, IReadOnlyList<string> parsedDirs, string wwwroot, Action<string> reparseAction, Func<DateTime?> pendingStatusFunc)
    {
        _replayDirectories = replayDirectories;
        _parsedDirs = parsedDirs;
        _wwwroot = wwwroot;
        _reparseAction = reparseAction;
        _pendingStatusFunc = pendingStatusFunc;
        _listener = new HttpListener();
        _listener.Prefixes.Add("http://127.0.0.1:5142/");
    }

    public void Start()
    {
        _listener.Start();
        Task.Run(ListenAsync);
        Console.WriteLine($"[Web Dashboard] Running at http://localhost:5142/");
    }

    private async Task ListenAsync()
    {
        while (_listener.IsListening)
        {
            try
            {
                var context = await _listener.GetContextAsync();
                _ = Task.Run(() => ProcessRequestAsync(context));
            }
            catch (HttpListenerException)
            {
                // Listener stopped
            }
            catch (ObjectDisposedException)
            {
                // Listener disposed
            }
        }
    }

    private async Task ProcessRequestAsync(HttpListenerContext context)
    {
        var request = context.Request;
        var response = context.Response;

        try
        {
            if (request.Url?.LocalPath == "/api/status")
            {
                await HandleApiStatusAsync(response);
            }
            else if (request.Url?.LocalPath == "/api/source-replays")
            {
                await HandleApiSourceReplaysAsync(response);
            }
            else if (request.Url?.LocalPath == "/api/reparse" && request.HttpMethod == "POST")
            {
                await HandleApiReparseAsync(request, response);
            }
            else if (request.Url?.LocalPath == "/api/replays")
            {
                await HandleApiReplaysAsync(response);
            }
            else if (request.Url?.LocalPath.StartsWith("/api/replays/") == true)
            {
                await HandleApiReplayFileAsync(request, response);
            }
            else
            {
                await ServeStaticFileAsync(request, response);
            }
        }
        catch (Exception ex)
        {
            response.StatusCode = 500;
            Console.WriteLine($"[HttpServer] Error processing request: {ex.Message}");
        }
        finally
        {
            response.Close();
        }
    }

    private async Task HandleApiReplaysAsync(HttpListenerResponse response)
    {
        response.ContentType = "application/json";
        response.AddHeader("Access-Control-Allow-Origin", "*");

        var files = _parsedDirs
            .Where(Directory.Exists)
            .SelectMany(d => Directory.GetFiles(d, "*.json"))
            .Select(f => new FileInfo(f))
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(f => new
            {
                filename = f.Name,
                mtime = new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds()
            })
            .ToList();

        var json = JsonSerializer.Serialize(files);
        await WriteStringAsync(response, json);
    }

    private async Task HandleApiStatusAsync(HttpListenerResponse response)
    {
        response.ContentType = "application/json";
        response.AddHeader("Access-Control-Allow-Origin", "*");

        var firstSeen = _pendingStatusFunc();
        var isLive = firstSeen.HasValue;
        var durationMinutes = isLive ? (int)(DateTime.UtcNow - firstSeen.Value).TotalMinutes : 0;

        var json = JsonSerializer.Serialize(new
        {
            isLive,
            durationMinutes
        });
        await WriteStringAsync(response, json);
    }

    private async Task HandleApiSourceReplaysAsync(HttpListenerResponse response)
    {
        response.ContentType = "application/json";
        response.AddHeader("Access-Control-Allow-Origin", "*");

        var parsedFiles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var dir in _parsedDirs.Where(Directory.Exists))
        {
            foreach (var f in Directory.GetFiles(dir, "*.json"))
            {
                parsedFiles.Add(Path.GetFileNameWithoutExtension(f));
            }
        }

        var files = _replayDirectories
            .Where(Directory.Exists)
            .SelectMany(d => Directory.GetFiles(d, "*.replay"))
            .Select(f => new FileInfo(f))
            .OrderByDescending(f => f.LastWriteTimeUtc)
            .Select(f => new
            {
                filename = f.Name,
                mtime = new DateTimeOffset(f.LastWriteTimeUtc).ToUnixTimeMilliseconds(),
                isParsed = parsedFiles.Contains(Path.GetFileNameWithoutExtension(f.Name))
            })
            .ToList();

        var json = JsonSerializer.Serialize(files);
        await WriteStringAsync(response, json);
    }

    private async Task HandleApiReparseAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        response.ContentType = "application/json";
        response.AddHeader("Access-Control-Allow-Origin", "*");

        try
        {
            using var reader = new StreamReader(request.InputStream, request.ContentEncoding);
            var body = await reader.ReadToEndAsync();
            var doc = JsonDocument.Parse(body);
            var target = doc.RootElement.GetProperty("target").GetString();

            if (!string.IsNullOrEmpty(target))
            {
                _reparseAction(target);
            }

            await WriteStringAsync(response, "{\"success\":true}");
        }
        catch (Exception ex)
        {
            response.StatusCode = 400;
            await WriteStringAsync(response, JsonSerializer.Serialize(new { success = false, error = ex.Message }));
        }
    }

    private async Task HandleApiReplayFileAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        var fileName = Uri.UnescapeDataString(request.Url!.LocalPath.Replace("/api/replays/", ""));
        
        string? filePath = null;
        foreach (var dir in _parsedDirs)
        {
            var candidate = Path.Combine(dir, fileName);
            if (File.Exists(candidate))
            {
                filePath = candidate;
                break;
            }
        }

        response.AddHeader("Access-Control-Allow-Origin", "*");

        if (filePath == null)
        {
            response.StatusCode = 404;
            return;
        }

        response.ContentType = "application/json";
        using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        await fs.CopyToAsync(response.OutputStream);
    }

    private async Task ServeStaticFileAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        var localPath = request.Url?.LocalPath == "/" ? "/index.html" : request.Url?.LocalPath;
        if (localPath == null) return;

        var filePath = Path.Combine(_wwwroot, localPath.TrimStart('/'));

        if (!File.Exists(filePath))
        {
            // SPA Fallback for client side routing
            filePath = Path.Combine(_wwwroot, "index.html");
            if (!File.Exists(filePath))
            {
                response.StatusCode = 404;
                await WriteStringAsync(response, "404 Not Found - React Dashboard missing (wwwroot not found). Ensure the ReplayDashboard.Client/dist folder is copied to wwwroot.");
                return;
            }
        }

        response.ContentType = GetContentType(filePath);
        using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        await fs.CopyToAsync(response.OutputStream);
    }

    private string GetContentType(string path)
    {
        var ext = Path.GetExtension(path).ToLowerInvariant();
        return ext switch
        {
            ".html" => "text/html",
            ".js" => "application/javascript",
            ".css" => "text/css",
            ".json" => "application/json",
            ".png" => "image/png",
            ".svg" => "image/svg+xml",
            ".ico" => "image/x-icon",
            _ => "application/octet-stream"
        };
    }

    private async Task WriteStringAsync(HttpListenerResponse response, string content)
    {
        var bytes = System.Text.Encoding.UTF8.GetBytes(content);
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes, 0, bytes.Length);
    }

    public void Dispose()
    {
        _listener.Close();
    }
}
