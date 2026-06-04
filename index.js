const fs = require('node:fs').promises;
const fsSync = require('node:fs');
const path = require('node:path');

/**
 * A logger class that provides structured logging with automatic file rotation,
 * sensitive data redaction, and Express middleware support.
 * @class
 */
class Logger {
    /**
     * Creates a new Logger instance with default configuration.
     * @constructor
     */
    constructor() {
        this.baseLogDir = path.join(process.cwd(), 'logs');
        this.maxFileSize = 10 * 1024 * 1024;

        this.priorities = { 'error': 0, 'warn': 1, 'info': 2, 'debug': 3 };
        this.minLevel = process.env.LOG_LEVEL || 'info';

        this.emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        this.uuidRegex = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
        this.longTokenRegex = /\b[a-z0-9-_]{30,}/gi;

        this.sensitiveKeys = [
            'to', 'email', 'username', 'subject', 'code', 'otp',
            'password', 'pwd', 'secret', 'token', 'auth', 'uuid',
            'phone', 'vat', 'device', 'address', 'key', 'host', 'database',
            'port', 'env', 'node_version', 'ip'
        ];
    }

    /**
     * Configures the logger with custom settings.
     * @param {Object} config - Configuration options
     * @param {string} [config.logDir] - Directory for log files (relative or absolute path)
     * @param {number} [config.maxFileSize] - Maximum file size in bytes before rotation (default: 10MB)
     * @param {string} [config.minLevel] - Minimum log level ('error', 'warn', 'info', 'debug')
     * @returns {Logger} The logger instance for method chaining
     */
    setup(config = {}) {
        if (config.logDir) {
            this.baseLogDir = path.isAbsolute(config.logDir) ? config.logDir : path.join(process.cwd(), config.logDir);
        }
        if (config.maxFileSize) this.maxFileSize = config.maxFileSize;
        if (config.minLevel && this.priorities[config.minLevel] !== undefined) {
            this.minLevel = config.minLevel;
        }
        return this;
    }

    /**
     * Gets the current timestamp in ISO format without milliseconds.
     * @private
     * @returns {string} Formatted timestamp (YYYY-MM-DD HH:MM:SS)
     */
    _getTimestamp() {
        return new Date().toISOString().replace(/T/, ' ').replace(/\..+/, '');
    }

    /**
     * Gets the current timestamp in US locale format.
     * @private
     * @returns {string} Formatted US timestamp (MM/DD/YYYY, HH:MM:SS)
     */
    _getUSTimestamp() {
        return new Date().toLocaleString('en-US', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
        });
    }

    /**
     * Gets the current date as a tag for log file naming.
     * @private
     * @returns {string} Date tag in YYYY-MM-DD format
     */
    _getDateTag() {
        const d = new Date();
        return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
    }

    /**
     * Redacts sensitive information from log messages.
     * Masks emails, UUIDs, long tokens, and sensitive key values.
     * @private
     * @param {string|Object} message - The message to redact
     * @returns {string|Object} The redacted message
     */
    _redact(message) {
        const maskValue = (val) => {
            if (typeof val === 'string') {
                let m = val.replace(this.emailRegex, 'DATA-REDACTED').replace(this.uuidRegex, 'DATA-REDACTED');
                if (m !== 'DATA-REDACTED' && m.length > 30) m = m.replace(this.longTokenRegex, 'DATA-REDACTED');
                return m;
            }
            return val;
        };

        const recursiveRedact = (obj) => {
            if (Array.isArray(obj)) return obj.map(item => recursiveRedact(item));
            if (obj !== null && typeof obj === 'object') {
                const newObj = {};
                for (const key in obj) {
                    const lowKey = key.toLowerCase();
                    newObj[key] = this.sensitiveKeys.some(k => lowKey.includes(k)) ? 'DATA-REDACTED' : recursiveRedact(obj[key]);
                }
                return newObj;
            }
            return maskValue(obj);
        };

        try {
            if (typeof message === 'object' && message !== null) {
                return recursiveRedact(message);
            }
            return maskValue(String(message));
        } catch (e) { return '[REDACTION_ERROR]'; }
    }

    /**
     * Internal logging method that handles message output and file writing.
     * @private
     * @async
     * @param {string} level - The log level ('error', 'warn', 'info', 'debug')
     * @param {string|Object} message - The message to log
     */
    async _log(level, message) {
        if (this.priorities[level] > this.priorities[this.minLevel]) return;

        const tsStd = this._getTimestamp();
        const tsUS = this._getUSTimestamp();
        const redacted = this._redact(message);

        const logObject = {
            timestamp: tsStd,
            timestamp_us: tsUS,
            level: level.toUpperCase(),
            message: redacted
        };
        const logEntry = JSON.stringify(logObject) + '\n';

        const colors = { info: '\x1b[32m', error: '\x1b[31m', warn: '\x1b[33m', debug: '\x1b[36m', reset: '\x1b[0m' };
        const color = colors[level] || colors.reset;
        process.stdout.write(`${color}[${level.toUpperCase()}]${colors.reset} [${tsUS}] ${typeof redacted === 'object' ? JSON.stringify(redacted, null, 2) : redacted}\n`);

        try {
            const dirPath = path.join(this.baseLogDir, level);
            if (!fsSync.existsSync(dirPath)) await fs.mkdir(dirPath, { recursive: true });

            const dateTag = this._getDateTag();
            let filePath = path.join(dirPath, `${level}-${dateTag}.txt`);

            try {
                const stats = await fs.stat(filePath);
                if (stats.size >= this.maxFileSize) {
                    let suffix = 1;
                    while (fsSync.existsSync(path.join(dirPath, `${level}-${dateTag}-${suffix}.txt`))) suffix++;
                    filePath = path.join(dirPath, `${level}-${dateTag}-${suffix}.txt`);
                }
            } catch (e) { }

            await fs.appendFile(filePath, logEntry, 'utf8');
        } catch (err) {
            process.stderr.write(`Logger Critical Error: ${err.message}\n`);
        }
    }

    /**
     * Logs an info level message.
     * @param {string|Object} msg - The message to log
     */
    info(msg) { this._log('info', msg); }

    /**
     * Logs an error level message.
     * @param {string|Object} msg - The message to log
     */
    error(msg) { this._log('error', msg); }

    /**
     * Logs a warning level message.
     * @param {string|Object} msg - The message to log
     */
    warn(msg) { this._log('warn', msg); }

    /**
     * Logs a debug level message.
     * @param {string|Object} msg - The message to log
     */
    debug(msg) { this._log('debug', msg); }

    /**
     * Returns Express middleware for logging HTTP requests.
     * Skips logging for /status endpoint.
     * @returns {Function} Express middleware function
     */
    getRequestMiddleware() {
        return (req, res, next) => {
            if (req.url === '/status' || req.path === '/status') {
                return next();
            }

            const start = Date.now();
            res.on('finish', () => {
                const duration = Date.now() - start;
                this.info({
                    event: 'HTTP_REQUEST',
                    method: req.method,
                    url: req.url,
                    status: res.statusCode,
                    duration: `${duration}ms`
                });
            });
            next();
        };
    }

    /**
     * Handles HTTP requests for viewing log files and directories.
     * Provides a simple API to browse and read log files.
     * @param {Object} req - HTTP request object
     * @param {Object} res - HTTP response object
     */
    handleRequest(req, res) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const parts = url.pathname.split('/').filter(Boolean);
        res.setHeader('Content-Type', 'application/json');

        const safePath = path.resolve(this.baseLogDir, ...parts);
        if (!safePath.startsWith(path.resolve(this.baseLogDir))) {
            res.statusCode = 403;
            return res.end(JSON.stringify({ error: 'Access Denied' }));
        }

        if (parts.length === 0) {
            const levels = fsSync.existsSync(this.baseLogDir) ? fsSync.readdirSync(this.baseLogDir) : [];
            return res.end(JSON.stringify({ levels }));
        }

        if (!fsSync.existsSync(safePath)) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ error: 'Not Found' }));
        }

        const stats = fsSync.statSync(safePath);
        if (stats.isDirectory()) {
            return res.end(JSON.stringify({ category: parts[parts.length - 1], files: fsSync.readdirSync(safePath) }));
        }

        if (stats.isFile()) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            const readStream = fsSync.createReadStream(safePath);
            readStream.on('error', () => { res.statusCode = 500; res.end("Read Error"); });
            return readStream.pipe(res);
        }
    }
}

module.exports = new Logger();