/**
 * Debug Agent — Hands-Free Code Debugging via Vision
 *
 * Look at any screen with code, errors, or technical content.
 * Agent reads it and gives you the fix through the speaker.
 *
 * Feature #6 from VISION-FEATURES-SPEC.md
 *
 * Capabilities:
 * - Stack trace analysis + root cause identification
 * - Code review with bug detection
 * - Config file syntax validation
 * - Log output interpretation
 * - Error message lookup + fix suggestions
 * - Multi-snap context accumulation
 * - Voice-friendly fix delivery
 *
 * 🌙 Built by Night Shift Agent
 */

import type { VisionAnalysis } from '../types.js';

// ─── Types ──────────────────────────────────────────────────────

export interface DebugConfig {
  /** Max number of context snapshots to keep */
  maxContextSnapshots: number;
  /** Include suggested fix in TTS output */
  suggestFixes: boolean;
  /** Include related issues / warnings */
  relatedWarnings: boolean;
  /** Max lines of code to analyze */
  maxCodeLines: number;
  /** Known project languages (prioritize these in detection) */
  projectLanguages: string[];
  /** Verbosity of TTS output */
  verbosity: 'brief' | 'normal' | 'detailed';
}

export interface DebugAnalysis {
  id: string;
  /** Type of content analyzed */
  contentType: DebugContentType;
  /** Detected programming language */
  language?: ProgrammingLanguage;
  /** The extracted code/error text */
  extractedCode: string;
  /** Identified problem(s) */
  problems: DebugProblem[];
  /** Suggested fix(es) */
  fixes: DebugFix[];
  /** Related warnings or notes */
  warnings: string[];
  /** Confidence in the analysis */
  confidence: number;
  /** Timestamp */
  analyzedAt: string;
  /** Source image ID */
  imageId?: string;
  /** Is this part of a multi-snap context? */
  contextIndex: number;
  totalContextSnaps: number;
}

export type DebugContentType =
  | 'stack_trace'
  | 'error_message'
  | 'code'
  | 'config'
  | 'log_output'
  | 'terminal'
  | 'api_response'
  | 'documentation'
  | 'mixed';

export type ProgrammingLanguage =
  | 'javascript' | 'typescript' | 'python' | 'java' | 'csharp'
  | 'go' | 'rust' | 'ruby' | 'php' | 'swift' | 'kotlin'
  | 'cpp' | 'c' | 'html' | 'css' | 'sql' | 'shell'
  | 'yaml' | 'json' | 'toml' | 'xml' | 'dockerfile'
  | 'terraform' | 'nginx' | 'unknown';

export interface DebugProblem {
  /** Human-readable problem description */
  description: string;
  /** Severity */
  severity: 'error' | 'warning' | 'info';
  /** Line number if identifiable */
  lineNumber?: number;
  /** Category of problem */
  category: ProblemCategory;
  /** Relevant code snippet */
  codeSnippet?: string;
}

export type ProblemCategory =
  | 'syntax_error'
  | 'null_reference'
  | 'type_error'
  | 'import_error'
  | 'runtime_error'
  | 'logic_error'
  | 'config_error'
  | 'dependency_error'
  | 'permission_error'
  | 'network_error'
  | 'timeout'
  | 'memory_error'
  | 'authentication_error'
  | 'deprecation'
  | 'security_issue'
  | 'performance_issue'
  | 'other';

export interface DebugFix {
  /** Description of what to change */
  description: string;
  /** The corrected code if applicable */
  correctedCode?: string;
  /** Confidence in this fix */
  confidence: number;
  /** Steps to apply the fix */
  steps?: string[];
}

export interface DebugSession {
  /** Context accumulated from multiple snaps */
  contextSnaps: ContextSnap[];
  /** Combined code/text from all snaps */
  combinedText: string;
  /** Session start time */
  startedAt: string;
  /** Is the session active? */
  active: boolean;
}

export interface ContextSnap {
  text: string;
  imageId: string;
  timestamp: string;
}

export interface DebugAgentStats {
  totalAnalyses: number;
  problemsFound: number;
  fixesSuggested: number;
  languagesEncountered: string[];
  contentTypeCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
}

// ─── Language Detection ─────────────────────────────────────────

interface LanguagePattern {
  language: ProgrammingLanguage;
  patterns: RegExp[];
  weight: number;
}

const LANGUAGE_PATTERNS: LanguagePattern[] = [
  // TypeScript (check before JavaScript because TS is a superset)
  {
    language: 'typescript',
    patterns: [
      /\b(interface|type|enum)\s+\w+/,
      /:\s*(string|number|boolean|void|any|never|unknown)\b/,
      /\bReadonly<|Partial<|Record<|Pick<|Omit</,
      /\.tsx?\b/,
      /as\s+(string|number|boolean|any)\b/,
      /<\w+>\s*\(/,
    ],
    weight: 3,
  },
  // JavaScript
  {
    language: 'javascript',
    patterns: [
      /\b(const|let|var)\s+\w+\s*=/,
      /\bfunction\s*\w*\s*\(/,
      /=>\s*[{(]/,
      /\b(require|module\.exports|import\s+.*\s+from)\b/,
      /\bconsole\.(log|error|warn)\b/,
      /\basync\s+(function|\()/,
      /\bawait\s+/,
      /\.js\b/,
    ],
    weight: 2,
  },
  // Python
  {
    language: 'python',
    patterns: [
      /\bdef\s+\w+\s*\(/,
      /\bclass\s+\w+(\(.*\))?:\s*$/m,
      /\bimport\s+\w+|from\s+\w+\s+import\b/,
      /\bself\.\w+/,
      /\bif\s+.*:\s*$/m,
      /\bprint\s*\(/,
      /\b(try|except|raise|finally)\b.*:/,
      /\bdef\s+__\w+__/,
      /\.py\b/,
      /Traceback \(most recent call last\)/,
    ],
    weight: 2,
  },
  // Java
  {
    language: 'java',
    patterns: [
      /\bpublic\s+(static\s+)?void\s+main\b/,
      /\bSystem\.(out|err)\.(println|print)\b/,
      /\bpackage\s+[\w.]+;/,
      /\bimport\s+java\./,
      /\bextends\s+\w+|implements\s+\w+/,
      /\.java\b/,
      /at\s+[\w.$]+\([\w.]+\.java:\d+\)/,
    ],
    weight: 2,
  },
  // C#
  {
    language: 'csharp',
    patterns: [
      /\bnamespace\s+[\w.]+/,
      /\busing\s+System/,
      /\b(public|private|protected)\s+(static\s+)?(void|int|string|bool|async)\s+\w+/,
      /\.cs\b/,
      /\bConsole\.(Write|ReadLine)\b/,
      /\bvar\s+\w+\s*=\s*new\b/,
    ],
    weight: 2,
  },
  // Go
  {
    language: 'go',
    patterns: [
      /\bfunc\s+(\(\w+\s+\*?\w+\)\s+)?\w+\(/,
      /\bpackage\s+\w+/,
      /\bfmt\.(Println|Printf|Sprintf)\b/,
      /\b:=\s*/,
      /\bgo\s+func\(/,
      /\.go\b/,
      /\bif\s+err\s*!=\s*nil\b/,
    ],
    weight: 2,
  },
  // Rust
  {
    language: 'rust',
    patterns: [
      /\bfn\s+\w+\s*(<.*>)?\s*\(/,
      /\blet\s+(mut\s+)?\w+/,
      /\bimpl\s+(<.*>)?\s*\w+/,
      /\bpub\s+(fn|struct|enum|trait)\b/,
      /\b(Ok|Err|Some|None)\(/,
      /\.rs\b/,
      /\bprintln!\(/,
      /\b(unwrap|expect)\(\)/,
    ],
    weight: 2,
  },
  // Ruby
  {
    language: 'ruby',
    patterns: [
      /\bdef\s+\w+(\s*\(.*\))?\s*$/m,
      /\bclass\s+\w+\s*<\s*\w+/,
      /\brequire\s+['"].*['"]/,
      /\bputs\s+/,
      /\bend\s*$/m,
      /\.rb\b/,
      /\b(attr_accessor|attr_reader|attr_writer)\b/,
    ],
    weight: 2,
  },
  // PHP
  {
    language: 'php',
    patterns: [
      /<\?php/,
      /\$\w+\s*=/,
      /\bfunction\s+\w+\s*\(/,
      /\becho\s+/,
      /->[\w]+\(/,
      /\.php\b/,
      /\buse\s+[\w\\]+;/,
    ],
    weight: 2,
  },
  // Shell/Bash
  {
    language: 'shell',
    patterns: [
      /^#!\/bin\/(ba)?sh/m,
      /\b(echo|export|source|chmod|mkdir|cd|ls|grep|awk|sed)\b/,
      /\$\{?\w+\}?/,
      /\b(if|then|else|fi|for|do|done|while|case|esac)\b/,
      /\|\s*(grep|awk|sed|sort|uniq)\b/,
    ],
    weight: 1,
  },
  // SQL
  {
    language: 'sql',
    patterns: [
      /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i,
      /\bFROM\s+\w+/i,
      /\bWHERE\s+/i,
      /\bJOIN\s+\w+\s+ON\b/i,
      /\bGROUP\s+BY\b/i,
    ],
    weight: 1,
  },
  // YAML
  {
    language: 'yaml',
    patterns: [
      /^\s*\w[\w-]*:\s+.+$/m,
      /^\s*-\s+\w/m,
      /^\s*\w+:\s*$/m,
      /\.ya?ml\b/,
    ],
    weight: 1,
  },
  // JSON
  {
    language: 'json',
    patterns: [
      /^\s*\{[\s\S]*"[\w]+"\s*:/m,
      /^\s*\[[\s\S]*\{/m,
      /\.json\b/,
    ],
    weight: 1,
  },
  // Dockerfile
  {
    language: 'dockerfile',
    patterns: [
      /^FROM\s+\w+/m,
      /^(RUN|CMD|COPY|ADD|EXPOSE|ENV|WORKDIR|ENTRYPOINT)\s+/m,
      /\bDockerfile\b/,
    ],
    weight: 1,
  },
  // HTML
  {
    language: 'html',
    patterns: [
      /<(html|head|body|div|span|p|a|img|form|input|button)\b/i,
      /<\/\w+>/,
      /<!DOCTYPE\s+html>/i,
      /\.html?\b/,
    ],
    weight: 1,
  },
  // CSS
  {
    language: 'css',
    patterns: [
      /\.\w+\s*\{[^}]*\}/,
      /#\w+\s*\{/,
      /\b(margin|padding|display|color|background|font-size|border)\s*:/,
      /\.css\b/,
      /@media\s+/,
    ],
    weight: 1,
  },
  // Nginx
  {
    language: 'nginx',
    patterns: [
      /\b(server|location|upstream)\s*\{/,
      /\b(listen|server_name|proxy_pass|root)\s+/,
      /nginx\.conf/,
    ],
    weight: 1,
  },
];

/**
 * Detect the programming language of code text.
 */
export function detectProgrammingLanguage(
  text: string,
  prioritized: string[] = []
): { language: ProgrammingLanguage; confidence: number } {
  if (!text || text.trim().length === 0) {
    return { language: 'unknown', confidence: 0 };
  }

  const scores: Record<string, number> = {};

  for (const lp of LANGUAGE_PATTERNS) {
    let matchCount = 0;
    for (const pattern of lp.patterns) {
      if (pattern.test(text)) matchCount++;
    }
    if (matchCount > 0) {
      let score = (matchCount / lp.patterns.length) * lp.weight;
      // Boost prioritized languages
      if (prioritized.includes(lp.language)) {
        score *= 1.3;
      }
      scores[lp.language] = score;
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && sorted[0][1] > 0) {
    return {
      language: sorted[0][0] as ProgrammingLanguage,
      confidence: Math.min(0.95, sorted[0][1]),
    };
  }

  return { language: 'unknown', confidence: 0 };
}

// ─── Content Classification ─────────────────────────────────────

const STACK_TRACE_PATTERNS = [
  /Traceback \(most recent call last\)/,             // Python
  /at\s+[\w.$]+\([\w.]+\.\w+:\d+\)/,                // Java/JS
  /^\s+at\s+.+\(.+:\d+:\d+\)/m,                     // Node.js
  /File\s+"[^"]+",\s+line\s+\d+/,                    // Python
  /\b(Error|Exception|Fault):\s+/,                   // Generic
  /goroutine\s+\d+\s+\[/,                            // Go
  /panic:\s+/,                                        // Go
  /thread\s+'[\w-]+'\s+panicked/,                    // Rust
  /^\s+\d+:\s+0x[0-9a-f]+\s+-\s+/m,                 // Rust backtrace
];

const ERROR_MESSAGE_PATTERNS = [
  /\b(Error|error|ERROR)\b[:\s]/,
  /\b(Warning|warning|WARN)\b[:\s]/,
  /\b(Fatal|fatal|FATAL)\b[:\s]/,
  /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b/,
  /\b(NullPointerException|ClassNotFoundException|IOException)\b/,
  /\b(ImportError|ModuleNotFoundError|AttributeError|KeyError|ValueError)\b/,
  /\bSegmentation fault\b/,
  /\bPermission denied\b/i,
  /\bConnection refused\b/i,
  /\b(ENOENT|EACCES|ECONNREFUSED|ETIMEDOUT)\b/,
];

const CONFIG_PATTERNS = [
  /^\s*\[[\w.-]+\]\s*$/m,                  // INI/TOML sections
  /^\s*\w[\w.-]*\s*[=:]\s*/m,              // Key-value pairs
  /^(server|location|upstream)\s*\{/m,      // Nginx
  /^(FROM|RUN|CMD|COPY|ADD)\s+/m,          // Dockerfile
  /^\s*\w+:\s*$/m,                          // YAML
];

const LOG_PATTERNS = [
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/,  // Timestamp
  /\[(INFO|DEBUG|WARN|ERROR|FATAL)\]/i,         // Log level brackets
  /\b(INFO|DEBUG|WARN|ERROR)\s+[\w.]+\s*[-:]/i, // Log level with logger
];

/**
 * Classify what type of debug content is being viewed.
 */
export function classifyDebugContent(text: string): DebugContentType {
  let stackScore = 0;
  let errorScore = 0;
  let configScore = 0;
  let logScore = 0;
  let codeScore = 0;

  for (const p of STACK_TRACE_PATTERNS) {
    if (p.test(text)) stackScore += 2;
  }
  for (const p of ERROR_MESSAGE_PATTERNS) {
    if (p.test(text)) errorScore += 1;
  }
  for (const p of CONFIG_PATTERNS) {
    if (p.test(text)) configScore += 1;
  }
  for (const p of LOG_PATTERNS) {
    if (p.test(text)) logScore += 1;
  }

  // Code detection: check for programming language indicators
  const langResult = detectProgrammingLanguage(text);
  if (langResult.language !== 'unknown') {
    codeScore = langResult.confidence * 3;
  }

  // Stack traces are distinctive
  if (stackScore >= 2) return 'stack_trace';

  // Error messages with code context
  if (errorScore >= 2 && codeScore > 0) return 'stack_trace';

  // Pure error messages
  if (errorScore >= 2) return 'error_message';

  // Log output
  if (logScore >= 2) return 'log_output';

  // Config files
  if (configScore >= 2 && codeScore < 2) return 'config';

  // Terminal output (has $, >, or command patterns)
  if (/^\s*[\$>]\s+\w+/m.test(text) || /^\s*\w+@[\w.-]+[:#~]/.test(text)) {
    return 'terminal';
  }

  // API response (JSON with status/error keys)
  if (/^\s*\{/.test(text) && /"(status|error|message|code)"/.test(text)) {
    return 'api_response';
  }

  // Default to code if we detected a language
  if (codeScore > 0) return 'code';

  return 'mixed';
}

// ─── Error Parsing ──────────────────────────────────────────────

interface ParsedError {
  errorType: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  category: ProblemCategory;
}

const ERROR_PARSERS: Array<{
  pattern: RegExp;
  parse: (match: RegExpMatchArray) => ParsedError;
}> = [
  // JavaScript/TypeScript: TypeError: Cannot read properties of null
  {
    pattern: /(TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError):\s*(.+)/,
    parse: (m) => ({
      errorType: m[1],
      message: m[2],
      category: m[1] === 'TypeError' ? 'type_error'
        : m[1] === 'ReferenceError' ? 'null_reference'
        : m[1] === 'SyntaxError' ? 'syntax_error'
        : 'runtime_error',
    }),
  },
  // Node.js: at Function.Module (internal/modules/cjs/loader.js:888)
  {
    pattern: /at\s+(?:[\w.$<>]+\s+)?\((.+):(\d+):(\d+)\)/,
    parse: (m) => ({
      errorType: 'StackFrame',
      message: `at ${m[1]}:${m[2]}:${m[3]}`,
      file: m[1],
      line: parseInt(m[2]),
      column: parseInt(m[3]),
      category: 'runtime_error',
    }),
  },
  // Python: File "app.py", line 42, in <module>
  {
    pattern: /File\s+"([^"]+)",\s+line\s+(\d+)(?:,\s+in\s+(\w+))?/,
    parse: (m) => ({
      errorType: 'PythonFrame',
      message: `at ${m[1]}:${m[2]}${m[3] ? ` in ${m[3]}` : ''}`,
      file: m[1],
      line: parseInt(m[2]),
      category: 'runtime_error',
    }),
  },
  // Python: ImportError / ModuleNotFoundError
  {
    pattern: /(ImportError|ModuleNotFoundError):\s*(.+)/,
    parse: (m) => ({
      errorType: m[1],
      message: m[2],
      category: 'import_error',
    }),
  },
  // Python: AttributeError / KeyError / ValueError
  {
    pattern: /(AttributeError|KeyError|ValueError|NameError|IndexError):\s*(.+)/,
    parse: (m) => ({
      errorType: m[1],
      message: m[2],
      category: m[1] === 'AttributeError' ? 'null_reference'
        : m[1] === 'KeyError' ? 'type_error'
        : 'runtime_error',
    }),
  },
  // Java: at com.example.App.main(App.java:42)
  {
    pattern: /at\s+([\w.$]+)\(([\w.]+):(\d+)\)/,
    parse: (m) => ({
      errorType: 'JavaFrame',
      message: `at ${m[1]}`,
      file: m[2],
      line: parseInt(m[3]),
      category: 'runtime_error',
    }),
  },
  // Java: NullPointerException
  {
    pattern: /(NullPointerException|ClassNotFoundException|IOException|IllegalArgumentException|ArrayIndexOutOfBoundsException):\s*(.*)/,
    parse: (m) => ({
      errorType: m[1],
      message: m[2] || m[1],
      category: m[1] === 'NullPointerException' ? 'null_reference'
        : m[1] === 'ClassNotFoundException' ? 'import_error'
        : 'runtime_error',
    }),
  },
  // Go: panic: runtime error
  {
    pattern: /panic:\s*(.+)/,
    parse: (m) => ({
      errorType: 'GoPanic',
      message: m[1],
      category: 'runtime_error',
    }),
  },
  // Permission/auth errors
  {
    pattern: /\b(Permission denied|Access denied|Unauthorized|Forbidden|EACCES)\b[:\s]*(.*)/i,
    parse: (m) => ({
      errorType: 'PermissionError',
      message: m[0],
      category: 'permission_error',
    }),
  },
  // Network errors
  {
    pattern: /\b(Connection refused|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH)\b[:\s]*(.*)/i,
    parse: (m) => ({
      errorType: 'NetworkError',
      message: m[0],
      category: 'network_error',
    }),
  },
  // Timeout errors
  {
    pattern: /\b(timeout|ETIMEDOUT|TimeoutError|deadline exceeded)\b[:\s]*(.*)/i,
    parse: (m) => ({
      errorType: 'TimeoutError',
      message: m[0],
      category: 'timeout',
    }),
  },
  // Memory errors
  {
    pattern: /\b(out of memory|OOMKilled|heap out of memory|MemoryError|ENOMEM)\b/i,
    parse: (m) => ({
      errorType: 'MemoryError',
      message: m[0],
      category: 'memory_error',
    }),
  },
  // Generic error with code
  {
    pattern: /\b(ENOENT|EISDIR|EEXIST|EPERM)\b[:\s]*(.*)/,
    parse: (m) => ({
      errorType: m[1],
      message: m[0],
      category: m[1] === 'ENOENT' ? 'runtime_error'
        : m[1] === 'EPERM' ? 'permission_error'
        : 'runtime_error',
    }),
  },
  // Deprecation
  {
    pattern: /\b(Deprecated|DeprecationWarning|deprecated)\b[:\s]*(.*)/i,
    parse: (m) => ({
      errorType: 'Deprecation',
      message: m[0],
      category: 'deprecation',
    }),
  },
];

/**
 * Parse error messages from text and extract structured information.
 */
export function parseErrors(text: string): ParsedError[] {
  const errors: ParsedError[] = [];
  const seen = new Set<string>();

  for (const parser of ERROR_PARSERS) {
    const matches = text.matchAll(new RegExp(parser.pattern, 'gm'));
    for (const match of matches) {
      const parsed = parser.parse(match);
      const key = `${parsed.errorType}:${parsed.message}`;
      if (!seen.has(key)) {
        seen.add(key);
        errors.push(parsed);
      }
    }
  }

  return errors;
}

// ─── Common Fix Patterns ────────────────────────────────────────

interface FixPattern {
  /** Error pattern to match */
  errorPattern: RegExp;
  /** Human-readable fix description */
  fixDescription: string;
  /** Steps to apply */
  steps: string[];
  /** Confidence in this fix */
  confidence: number;
}

const COMMON_FIXES: FixPattern[] = [
  {
    errorPattern: /Cannot read properties of (null|undefined)/i,
    fixDescription: 'Null/undefined reference. Add a null check before accessing the property.',
    steps: [
      'Find the variable being accessed (before the dot or bracket)',
      'Add a null/undefined check: if (variable) { ... }',
      'Or use optional chaining: variable?.property',
      'Or use nullish coalescing: variable ?? defaultValue',
    ],
    confidence: 0.85,
  },
  {
    errorPattern: /is not a function/i,
    fixDescription: 'Trying to call something that isn\'t a function. Check your import and variable type.',
    steps: [
      'Verify the import is correct (named vs default export)',
      'Check if the variable is defined and is actually a function',
      'Check for typos in the function name',
      'Make sure the module is installed: npm install <package>',
    ],
    confidence: 0.8,
  },
  {
    errorPattern: /Cannot find module|ModuleNotFoundError|No module named/i,
    fixDescription: 'Missing module/package. Install the dependency.',
    steps: [
      'For Node.js: npm install <module-name>',
      'For Python: pip install <module-name>',
      'Check for typos in the import path',
      'If local file: verify the file path is correct relative to the importing file',
    ],
    confidence: 0.9,
  },
  {
    errorPattern: /SyntaxError:\s*Unexpected token/i,
    fixDescription: 'Syntax error — unexpected character in code.',
    steps: [
      'Check the line number for mismatched brackets, braces, or parentheses',
      'Look for missing commas, semicolons, or colons',
      'If in JSON: ensure all keys are quoted and no trailing commas',
      'Check for copy-paste artifacts (smart quotes, invisible characters)',
    ],
    confidence: 0.85,
  },
  {
    errorPattern: /ECONNREFUSED|Connection refused/i,
    fixDescription: 'Connection refused. The target service isn\'t running or is on a different port.',
    steps: [
      'Verify the service is running (docker ps, systemctl status, etc.)',
      'Check the port number matches the service configuration',
      'If Docker: ensure the container is on the correct network',
      'Check firewall rules if connecting to a remote host',
    ],
    confidence: 0.85,
  },
  {
    errorPattern: /ENOENT.*no such file or directory/i,
    fixDescription: 'File not found. The path doesn\'t exist.',
    steps: [
      'Verify the file/directory path is correct',
      'Check for relative vs absolute path issues',
      'On Windows: check for path separator issues (/ vs \\)',
      'Ensure the file was created before this code tries to read it',
    ],
    confidence: 0.9,
  },
  {
    errorPattern: /CORS|Access-Control-Allow-Origin/i,
    fixDescription: 'CORS error. The server needs to allow requests from your origin.',
    steps: [
      'Add CORS headers to the server response',
      'For Express: use the cors middleware — app.use(cors())',
      'For development: use a proxy in your build tool config',
      'Check if credentials: true is needed for cookies',
    ],
    confidence: 0.85,
  },
  {
    errorPattern: /JWT|token.*expired|unauthorized|401/i,
    fixDescription: 'Authentication error. Token may be expired or invalid.',
    steps: [
      'Check if the token has expired (decode it at jwt.io)',
      'Verify the token is being sent in the correct header (Authorization: Bearer)',
      'Check if the secret/key used for signing matches the server',
      'Implement token refresh logic for expired tokens',
    ],
    confidence: 0.8,
  },
  {
    errorPattern: /out of memory|heap|OOM/i,
    fixDescription: 'Out of memory. The process needs more RAM or has a memory leak.',
    steps: [
      'For Node.js: increase heap — node --max-old-space-size=4096',
      'Check for memory leaks: uncleared intervals, growing arrays, event listeners',
      'Profile memory usage to find the culprit',
      'Consider streaming large data instead of loading all at once',
    ],
    confidence: 0.8,
  },
  {
    errorPattern: /Permission denied|EACCES|EPERM/i,
    fixDescription: 'Permission denied. The process doesn\'t have access to the resource.',
    steps: [
      'Check file/directory permissions (ls -la or icacls)',
      'If port < 1024: use a higher port or run with elevated privileges',
      'For Docker: check volume mount permissions',
      'Don\'t use sudo as a fix — change the ownership instead (chown)',
    ],
    confidence: 0.85,
  },
  {
    errorPattern: /Segmentation fault|segfault|SIGSEGV/i,
    fixDescription: 'Segmentation fault. Accessing memory you shouldn\'t be.',
    steps: [
      'Run with a debugger (gdb, lldb) to find the exact location',
      'Check for null pointer dereferences',
      'Check for buffer overflows or out-of-bounds array access',
      'Ensure all pointers are initialized before use',
    ],
    confidence: 0.75,
  },
  {
    errorPattern: /deadlock|Deadlock/,
    fixDescription: 'Deadlock detected. Two or more processes are waiting for each other.',
    steps: [
      'Check for circular lock dependencies',
      'Ensure locks are always acquired in the same order',
      'Consider using timeout-based locking',
      'Check database queries for row-level lock conflicts',
    ],
    confidence: 0.75,
  },
];

/**
 * Find applicable fixes for the given errors.
 */
export function findFixes(errors: ParsedError[], fullText: string): DebugFix[] {
  const fixes: DebugFix[] = [];
  const seen = new Set<string>();

  for (const fix of COMMON_FIXES) {
    // Check against each error message
    for (const error of errors) {
      if (fix.errorPattern.test(error.message) || fix.errorPattern.test(error.errorType)) {
        if (!seen.has(fix.fixDescription)) {
          seen.add(fix.fixDescription);
          fixes.push({
            description: fix.fixDescription,
            confidence: fix.confidence,
            steps: fix.steps,
          });
        }
      }
    }

    // Also check against the full text
    if (fix.errorPattern.test(fullText) && !seen.has(fix.fixDescription)) {
      seen.add(fix.fixDescription);
      fixes.push({
        description: fix.fixDescription,
        confidence: fix.confidence * 0.8, // Slightly lower confidence when matching full text
        steps: fix.steps,
      });
    }
  }

  return fixes;
}

// ─── Line Number Extraction ─────────────────────────────────────

/**
 * Extract line numbers mentioned in error messages.
 */
export function extractLineNumbers(text: string): number[] {
  const lineNums = new Set<number>();

  // "line 42" pattern
  const linePatterns = [
    /line\s+(\d+)/gi,
    /:(\d+):\d+/g,          // file:line:col
    /\.(?:js|ts|py|rb|go|rs|java|cs|php|c|cpp|h):(\d+)/g,  // file.ext:line
    /at\s+line\s+(\d+)/gi,
    /Line\s+(\d+)/g,
  ];

  for (const pattern of linePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const num = parseInt(match[1]);
      if (num > 0 && num < 100000) {
        lineNums.add(num);
      }
    }
  }

  return [...lineNums].sort((a, b) => a - b);
}

// ─── Debug Agent ────────────────────────────────────────────────

const DEFAULT_CONFIG: DebugConfig = {
  maxContextSnapshots: 10,
  suggestFixes: true,
  relatedWarnings: true,
  maxCodeLines: 500,
  projectLanguages: [],
  verbosity: 'normal',
};

export class DebugAgent {
  private config: DebugConfig;
  private session: DebugSession;
  private history: DebugAnalysis[] = [];
  private stats: DebugAgentStats = {
    totalAnalyses: 0,
    problemsFound: 0,
    fixesSuggested: 0,
    languagesEncountered: [],
    contentTypeCounts: {},
    categoryCounts: {},
  };

  constructor(config: Partial<DebugConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.session = {
      contextSnaps: [],
      combinedText: '',
      startedAt: new Date().toISOString(),
      active: false,
    };
  }

  /**
   * Handle a vision analysis result — analyze code/errors from screen capture.
   */
  async handle(
    _image: Buffer,
    analysis: VisionAnalysis,
    _context?: Record<string, unknown>
  ): Promise<DebugAnalysis> {
    // Extract all text from the vision analysis
    const allText = analysis.extractedText
      .map(t => t.text)
      .join('\n')
      .trim();

    // Add to context session if active
    if (this.session.active) {
      this.session.contextSnaps.push({
        text: allText,
        imageId: analysis.imageId,
        timestamp: new Date().toISOString(),
      });
      if (this.session.contextSnaps.length > this.config.maxContextSnapshots) {
        this.session.contextSnaps.shift();
      }
      this.session.combinedText = this.session.contextSnaps.map(s => s.text).join('\n\n---\n\n');
    }

    // Use combined text if in session, otherwise just current text
    const textToAnalyze = this.session.active ? this.session.combinedText : allText;

    // Classify content type
    const contentType = classifyDebugContent(textToAnalyze);

    // Detect programming language
    const langResult = detectProgrammingLanguage(textToAnalyze, this.config.projectLanguages);

    // Parse errors
    const parsedErrors = parseErrors(textToAnalyze);

    // Build problems list
    const problems: DebugProblem[] = parsedErrors.map(err => ({
      description: `${err.errorType}: ${err.message}`,
      severity: err.category === 'deprecation' ? 'warning' as const : 'error' as const,
      lineNumber: err.line,
      category: err.category,
      codeSnippet: err.file ? `${err.file}:${err.line ?? '?'}` : undefined,
    }));

    // Find applicable fixes
    const fixes = this.config.suggestFixes ? findFixes(parsedErrors, textToAnalyze) : [];

    // Extract warnings
    const warnings: string[] = [];
    if (this.config.relatedWarnings) {
      const lineNums = extractLineNumbers(textToAnalyze);
      if (lineNums.length > 0) {
        warnings.push(`Line numbers referenced: ${lineNums.join(', ')}`);
      }

      // Check for common anti-patterns
      if (/console\.log/g.test(textToAnalyze)) {
        warnings.push('Debug console.log statements detected — remove before production.');
      }
      if (/TODO|FIXME|HACK|XXX/.test(textToAnalyze)) {
        warnings.push('TODO/FIXME markers found in the code.');
      }
      if (/eval\s*\(/.test(textToAnalyze)) {
        warnings.push('⚠️ eval() usage detected — security risk.');
      }
      if (/password\s*=\s*['"][^'"]+['"]/i.test(textToAnalyze)) {
        warnings.push('⚠️ Hardcoded password detected — security risk.');
      }
    }

    const result: DebugAnalysis = {
      id: `dbg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      contentType,
      language: langResult.language !== 'unknown' ? langResult.language : undefined,
      extractedCode: allText,
      problems,
      fixes,
      warnings,
      confidence: langResult.confidence,
      analyzedAt: new Date().toISOString(),
      imageId: analysis.imageId,
      contextIndex: this.session.active ? this.session.contextSnaps.length : 1,
      totalContextSnaps: this.session.active ? this.session.contextSnaps.length : 1,
    };

    // Update stats
    this.updateStats(result);

    // Add to history
    this.history.unshift(result);
    if (this.history.length > 100) {
      this.history = this.history.slice(0, 100);
    }

    return result;
  }

  /**
   * Start a multi-snap context session (for scrolling through code).
   */
  startContextSession(): void {
    this.session = {
      contextSnaps: [],
      combinedText: '',
      startedAt: new Date().toISOString(),
      active: true,
    };
  }

  /**
   * End the context session.
   */
  endContextSession(): DebugSession {
    this.session.active = false;
    const session = { ...this.session, contextSnaps: [...this.session.contextSnaps] };
    this.session.contextSnaps = [];
    this.session.combinedText = '';
    return session;
  }

  /**
   * Check if a context session is active.
   */
  isSessionActive(): boolean {
    return this.session.active;
  }

  /**
   * Get context snap count in current session.
   */
  getContextCount(): number {
    return this.session.contextSnaps.length;
  }

  /**
   * Generate a voice-friendly summary of the debug analysis.
   */
  generateVoiceSummary(analysis: DebugAnalysis): string {
    const parts: string[] = [];

    // Language identification
    if (analysis.language) {
      parts.push(`${analysis.language} code detected.`);
    }

    // Content type context
    switch (analysis.contentType) {
      case 'stack_trace':
        parts.push('I see a stack trace.');
        break;
      case 'error_message':
        parts.push('I see an error message.');
        break;
      case 'config':
        parts.push('This looks like a configuration file.');
        break;
      case 'log_output':
        parts.push('This is log output.');
        break;
    }

    // Problems
    if (analysis.problems.length === 0) {
      parts.push('No obvious errors detected.');
    } else {
      const errorCount = analysis.problems.filter(p => p.severity === 'error').length;
      const warningCount = analysis.problems.filter(p => p.severity === 'warning').length;

      if (errorCount > 0) {
        parts.push(`Found ${errorCount} error${errorCount > 1 ? 's' : ''}.`);
      }
      if (warningCount > 0) {
        parts.push(`${warningCount} warning${warningCount > 1 ? 's' : ''}.`);
      }

      // Describe the first (most important) problem
      const mainProblem = analysis.problems[0];
      if (this.config.verbosity === 'brief') {
        parts.push(mainProblem.description.slice(0, 100));
      } else {
        parts.push(mainProblem.description);
        if (mainProblem.lineNumber) {
          parts.push(`At line ${mainProblem.lineNumber}.`);
        }
      }
    }

    // Fixes
    if (analysis.fixes.length > 0 && this.config.verbosity !== 'brief') {
      const topFix = analysis.fixes[0];
      parts.push(`Fix: ${topFix.description}`);

      if (this.config.verbosity === 'detailed' && topFix.steps) {
        parts.push(`Steps: ${topFix.steps[0]}`);
      }
    }

    // Security warnings
    const securityWarnings = analysis.warnings.filter(w => w.includes('⚠️'));
    if (securityWarnings.length > 0) {
      parts.push(securityWarnings[0]);
    }

    // Context session info
    if (analysis.totalContextSnaps > 1) {
      parts.push(`Analyzing ${analysis.totalContextSnaps} snapshots of context.`);
    }

    return parts.join(' ');
  }

  /**
   * Get analysis history.
   */
  getHistory(limit: number = 20): DebugAnalysis[] {
    return this.history.slice(0, limit);
  }

  /**
   * Get agent statistics.
   */
  getStats(): DebugAgentStats {
    return { ...this.stats };
  }

  /**
   * Set project languages for prioritized detection.
   */
  setProjectLanguages(languages: string[]): void {
    this.config.projectLanguages = languages;
  }

  /**
   * Set verbosity level.
   */
  setVerbosity(level: 'brief' | 'normal' | 'detailed'): void {
    this.config.verbosity = level;
  }

  private updateStats(analysis: DebugAnalysis): void {
    this.stats.totalAnalyses++;
    this.stats.problemsFound += analysis.problems.length;
    this.stats.fixesSuggested += analysis.fixes.length;

    if (analysis.language && !this.stats.languagesEncountered.includes(analysis.language)) {
      this.stats.languagesEncountered.push(analysis.language);
    }

    const ct = analysis.contentType;
    this.stats.contentTypeCounts[ct] = (this.stats.contentTypeCounts[ct] ?? 0) + 1;

    for (const problem of analysis.problems) {
      const cat = problem.category;
      this.stats.categoryCounts[cat] = (this.stats.categoryCounts[cat] ?? 0) + 1;
    }
  }
}
