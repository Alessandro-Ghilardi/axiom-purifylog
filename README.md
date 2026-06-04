# axiom-purifylog

A privacy-first Node.js logger with automatic sensitive data redaction, file rotation, and a built-in HTTP log viewer.

## Features

- 🔒 **Automatic Sensitive Data Redaction**: Recursively masks emails, UUIDs, long tokens, and blacklisted keys (passwords, API keys, IPs, etc.) in both strings and deep JSON objects.
- 🔄 **Built-in File Rotation**: Automatically rotates and suffixes log files when they reach the maximum size limit (defaults to 10MB).
- 📂 **Structured Level Directory Separation**: Automatically organizes logs into structured directories based on their level (`/logs/info`, `/logs/error`, etc.).
- 🌐 **On-the-fly HTTP Log Viewer**: Expose a lightweight endpoint to safely browse and read your raw log files directly from a browser or via API.
- 🔌 **Express Middleware**: Out-of-the-box HTTP request logging middleware with automatic `/status` health-check filtering.

## Installation

```bash
npm install axiom-purifylog
```

## Quick Start

```javascript
const logger = require('axiom-purifylog');

// Simple logs
logger.info('Application started successfully');
logger.warn('Database connection retrying...');
logger.error('Failed to load resource');
```

## Feature Deep Dive

### 1. Automatic Sensitive Data Masking (Redaction)

axiom-purifylog automatically intercepts strings and objects to sanitize sensitive information before printing to stdout or writing to disk.

```javascript
logger.info({
    message: "User login attempt",
    email: "john.doe@example.com", // Will be redacted
    metadata: {
        ip: "192.168.1.1",        // Will be redacted
        sessionToken: "a-very-long-token-identifier-that-should-not-leak", // Will be redacted
        nested: {
            password: "super-secret-password-123", // Will be redacted
            address: "123 Main St, Anytown, USA", // Will be redacted
            active: true // Kept intact
        }
    }
});
```

**Output in Console / Log File:**

```json
{
  "message": "User login attempt",
  "email": "DATA-REDACTED",
  "metadata": {
    "ip": "DATA-REDACTED",
    "sessionToken": "DATA-REDACTED",
    "nested": {
      "password": "DATA-REDACTED",
      "active": true
    }
  }
}
```

**Default Redacted Keys & Patterns:**

- **Regex Patterns**: Emails, UUIDs, and strings longer than 30 characters matching token formats.
- **Sensitive Keys**: `to`, `email`, `username`, `subject`, `code`, `otp`, `password`, `pwd`, `secret`, `token`, `auth`, `uuid`, `phone`, `vat`, `device`, `address`, `key`, `host`, `database`, `port`, `env`, `node_version`, `ip`.

### 2. Configuration (.setup())

Configure the logger instance at the entry point of your application.

```javascript
logger.setup({
    logDir: 'custom-logs-folder',    // Relative or absolute path (default: './logs')
    maxFileSize: 5 * 1024 * 1024,    // Max file size in bytes before rotation (default: 10MB)
    minLevel: 'debug'                // Minimum level to log: 'error' | 'warn' | 'info' | 'debug'
});
```

**Note**: You can also set the minimum logging level globally using the `LOG_LEVEL` environment variable.

### 3. Express Middleware

Easily log incoming HTTP requests. The middleware automatically measures response duration and skips noisy `/status` endpoints.

```javascript
const express = require('express');
const logger = require('axiom-purifylog');

const app = express();

app.use(logger.getRequestMiddleware());

app.get('/users', (req, res) => {
    res.json({ ok: true });
});
```

### 4. Built-in HTTP Log Viewer

Expose an administrative endpoint to browse directories and read log files directly over HTTP. Path traversal attacks are prevented out-of-the-box by strict directory boundaries.

```javascript
const http = require('http');
const logger = require('axiom-purifylog');

http.createServer((req, res) => {
    // Route logs requests to the logger handler
    if (req.url.startsWith('/admin/logs')) {
        // Strip the custom prefix so the logger maps to the correct internal directories
        req.url = req.url.replace('/admin/logs', '') || '/';
        return logger.handleRequest(req, res);
    }
    
    res.writeHead(404);
    res.end('Not Found');
}).listen(3000, () => {
    console.log('Admin log viewer available at http://localhost:3000/admin/logs');
});
```

**API / Viewer Behavior:**

- `GET /`: Returns JSON list of available log level directories: `{"levels":["info","error"]}`
- `GET /info`: Returns JSON list of files in that folder: `{"category":"info","files":["info-2026-06-04.txt"]}`
- `GET /info/info-2026-06-04.txt`: Streams the raw log file back as `text/plain`.

## Log File Structure & Rotation

Logs are saved on disk using the following hierarchy:

```
logs/
├── info/
│   ├── info-2026-06-04.txt
│   └── info-2026-06-04-1.txt (Rotated file)
├── error/
│   └── error-2026-06-04.txt
└── debug/
```

Each line in the log file is a structured JSON string, making it easy to parse with log aggregators:

```json
{"timestamp":"2026-06-04 18:45:00","timestamp_us":"06/04/2026, 18:45:00","level":"INFO","message":"Server listening on port 3000"}
```

## License

This project is licensed under the MIT License.