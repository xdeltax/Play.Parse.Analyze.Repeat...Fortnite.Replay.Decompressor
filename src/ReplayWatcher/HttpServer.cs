using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

public sealed class HttpServer : IDisposable
{
    private readonly HttpListener _listener;
    private readonly string _parsedDir;
    private readonly string _wwwroot;

    public HttpServer(string parsedDir, string wwwroot)
    {
        _parsedDir = parsedDir;
        _wwwroot = wwwroot;
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
            if (request.Url?.LocalPath == "/api/replays")
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

        if (!Directory.Exists(_parsedDir))
        {
            await WriteStringAsync(response, "[]");
            return;
        }

        var files = Directory.GetFiles(_parsedDir, "*.json")
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

    private async Task HandleApiReplayFileAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        var fileName = Uri.UnescapeDataString(request.Url!.LocalPath.Replace("/api/replays/", ""));
        var filePath = Path.Combine(_parsedDir, fileName);

        response.AddHeader("Access-Control-Allow-Origin", "*");

        if (!File.Exists(filePath))
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
