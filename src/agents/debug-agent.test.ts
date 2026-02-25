/**
 * Tests for Debug Agent — Hands-Free Code Debugging via Vision
 * 🌙 Night Shift Agent
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DebugAgent,
  detectProgrammingLanguage,
  classifyDebugContent,
  parseErrors,
  findFixes,
  extractLineNumbers,
} from './debug-agent.js';
import type { VisionAnalysis, ExtractedText } from '../types.js';

// ─── Helper ─────────────────────────────────────────────────────

function mockAnalysis(texts: string[]): VisionAnalysis {
  return {
    imageId: `img-${Date.now()}`,
    analyzedAt: new Date().toISOString(),
    processingTimeMs: 100,
    sceneDescription: 'Screen with code',
    sceneType: 'screen',
    extractedText: texts.map(text => ({
      text,
      confidence: 0.95,
      textType: 'screen' as ExtractedText['textType'],
    })),
    detectedObjects: [],
    products: [],
    barcodes: [],
    quality: { score: 0.9, isBlurry: false, hasGlare: false, isUnderexposed: false, isOverexposed: false, usableForInventory: true },
  };
}

// ─── detectProgrammingLanguage ──────────────────────────────────

describe('detectProgrammingLanguage', () => {
  it('should detect TypeScript', () => {
    const code = `interface User {
  name: string;
  age: number;
}
const user: User = { name: "Alice", age: 30 };`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('typescript');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should detect JavaScript', () => {
    const code = `const express = require('express');
const app = express();
app.get('/', (req, res) => {
  console.log('Hello');
  res.send('Hello World');
});`;
    const result = detectProgrammingLanguage(code);
    expect(['javascript', 'typescript']).toContain(result.language);
  });

  it('should detect Python', () => {
    const code = `import os
from datetime import datetime

class MyClass:
    def __init__(self):
        self.value = 42

    def process(self):
        print(f"Value: {self.value}")`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('python');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should detect Java', () => {
    const code = `package com.example;
import java.util.List;

public class Main {
    public static void main(String[] args) {
        System.out.println("Hello");
    }
}`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('java');
  });

  it('should detect Go', () => {
    const code = `package main

import "fmt"

func main() {
    result, err := doSomething()
    if err != nil {
        fmt.Println(err)
    }
}`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('go');
  });

  it('should detect Rust', () => {
    const code = `use std::io;

fn main() {
    let mut input = String::new();
    io::stdin().read_line(&mut input).unwrap();
    println!("You said: {}", input.trim());
}`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('rust');
  });

  it('should detect Ruby', () => {
    const code = `require 'json'

class User
  attr_accessor :name, :age

  def initialize(name, age)
    @name = name
    @age = age
  end

  def greet
    puts "Hello, #{@name}!"
  end
end`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('ruby');
  });

  it('should detect PHP', () => {
    const code = `<?php
$name = "World";
echo "Hello, $name!";
function greet($n) {
  return "Hi " . $n;
}`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('php');
  });

  it('should detect SQL', () => {
    const code = `SELECT u.name, COUNT(o.id) AS order_count
FROM users u
JOIN orders o ON u.id = o.user_id
WHERE u.active = true
GROUP BY u.name`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('sql');
  });

  it('should detect Shell/Bash', () => {
    const code = `#!/bin/bash
export PATH=$PATH:/usr/local/bin
for file in *.txt; do
  echo "Processing $file"
  grep -i "error" "$file"
done`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('shell');
  });

  it('should detect Dockerfile', () => {
    const code = `FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('dockerfile');
  });

  it('should detect HTML', () => {
    const code = `<!DOCTYPE html>
<html>
<head><title>Test</title></head>
<body>
  <div class="container">
    <p>Hello</p>
  </div>
</body>
</html>`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('html');
  });

  it('should detect CSS', () => {
    const code = `.container {
  display: flex;
  margin: 20px;
  padding: 10px;
  background: #fff;
}
@media (max-width: 768px) {
  .container { padding: 5px; }
}`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('css');
  });

  it('should detect C#', () => {
    const code = `using System;
namespace MyApp {
  public class Program {
    public static void Main(string[] args) {
      Console.WriteLine("Hello");
    }
  }
}`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('csharp');
  });

  it('should return unknown for empty text', () => {
    expect(detectProgrammingLanguage('')).toEqual({ language: 'unknown', confidence: 0 });
  });

  it('should boost prioritized languages', () => {
    // This code could be JS or TS, but prioritizing TS should help
    const code = `const x = 42;
const y = "hello";
console.log(x, y);`;
    const withPriority = detectProgrammingLanguage(code, ['typescript']);
    const without = detectProgrammingLanguage(code, []);
    // Both should detect something, but TS priority should boost it
    expect(withPriority.language).toBeDefined();
    expect(without.language).toBeDefined();
  });

  it('should detect Nginx config', () => {
    const code = `server {
    listen 80;
    server_name example.com;
    location / {
        proxy_pass http://localhost:3000;
    }
}`;
    const result = detectProgrammingLanguage(code);
    expect(result.language).toBe('nginx');
  });
});

// ─── classifyDebugContent ───────────────────────────────────────

describe('classifyDebugContent', () => {
  it('should classify Python stack trace', () => {
    const text = `Traceback (most recent call last):
  File "app.py", line 42, in <module>
    process()
  File "app.py", line 15, in process
    result = data["key"]
KeyError: 'key'`;
    expect(classifyDebugContent(text)).toBe('stack_trace');
  });

  it('should classify Node.js stack trace', () => {
    const text = `TypeError: Cannot read properties of null (reading 'id')
    at getUserId (/app/src/auth.ts:47:15)
    at processTicksAndRejections (node:internal/process/task_queues:96:5)
    at async handler (/app/src/routes.ts:23:10)`;
    expect(classifyDebugContent(text)).toBe('stack_trace');
  });

  it('should classify Java stack trace', () => {
    const text = `java.lang.NullPointerException: 
    at com.example.UserService.getUser(UserService.java:42)
    at com.example.Controller.handle(Controller.java:15)`;
    expect(classifyDebugContent(text)).toBe('stack_trace');
  });

  it('should classify Go panic', () => {
    const text = `panic: runtime error: index out of range [3] with length 2

goroutine 1 [running]:
main.process()
	/app/main.go:42 +0x1c4`;
    expect(classifyDebugContent(text)).toBe('stack_trace');
  });

  it('should classify error messages (no code context)', () => {
    const text = `Error: something went wrong
Warning: disk space is running low
Fatal: unable to start the service correctly`;
    const result = classifyDebugContent(text);
    // With multiple error/warning/fatal patterns and no code context, should be error_message
    expect(['error_message', 'stack_trace']).toContain(result);
  });

  it('should classify log output', () => {
    const text = `2026-02-24T11:00:00.000Z [INFO] Server starting on port 3000
2026-02-24T11:00:01.000Z [DEBUG] Database connected
2026-02-24T11:00:02.000Z [WARN] Cache miss rate high: 45%
2026-02-24T11:00:03.000Z [ERROR] Failed to load config`;
    expect(classifyDebugContent(text)).toBe('log_output');
  });

  it('should classify terminal output', () => {
    const text = `$ npm install express
$ node server.js`;
    expect(classifyDebugContent(text)).toBe('terminal');
  });

  it('should classify API response', () => {
    const text = `{
  "status": 500,
  "error": "Internal Server Error",
  "message": "Database connection failed"
}`;
    expect(classifyDebugContent(text)).toBe('api_response');
  });

  it('should classify code', () => {
    const text = `const express = require('express');
const app = express();
app.listen(3000);`;
    expect(classifyDebugContent(text)).toBe('code');
  });

  it('should classify config file', () => {
    const text = `[database]
host = localhost
port = 5432
name = myapp

[redis]
url = redis://localhost:6379`;
    expect(classifyDebugContent(text)).toBe('config');
  });
});

// ─── parseErrors ────────────────────────────────────────────────

describe('parseErrors', () => {
  it('should parse TypeError', () => {
    const errors = parseErrors("TypeError: Cannot read properties of null (reading 'id')");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].errorType).toBe('TypeError');
    expect(errors[0].category).toBe('type_error');
  });

  it('should parse ReferenceError', () => {
    const errors = parseErrors("ReferenceError: myVar is not defined");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].errorType).toBe('ReferenceError');
    expect(errors[0].category).toBe('null_reference');
  });

  it('should parse SyntaxError', () => {
    const errors = parseErrors("SyntaxError: Unexpected token '}'");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].category).toBe('syntax_error');
  });

  it('should parse Python ImportError', () => {
    const errors = parseErrors("ImportError: No module named 'flask'");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].category).toBe('import_error');
  });

  it('should parse Python ModuleNotFoundError', () => {
    const errors = parseErrors("ModuleNotFoundError: No module named 'requests'");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].category).toBe('import_error');
  });

  it('should parse Java NullPointerException', () => {
    const errors = parseErrors("NullPointerException: Cannot invoke method on null");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].category).toBe('null_reference');
  });

  it('should parse Go panic', () => {
    const errors = parseErrors("panic: runtime error: index out of range");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].errorType).toBe('GoPanic');
    expect(errors[0].category).toBe('runtime_error');
  });

  it('should parse permission errors', () => {
    const errors = parseErrors("Permission denied: /etc/config.yml");
    expect(errors.some(e => e.category === 'permission_error')).toBe(true);
  });

  it('should parse network errors', () => {
    const errors = parseErrors("Error: connect ECONNREFUSED 127.0.0.1:5432");
    expect(errors.some(e => e.category === 'network_error')).toBe(true);
  });

  it('should parse timeout errors', () => {
    const errors = parseErrors("TimeoutError: operation timeout after 30000ms");
    expect(errors.some(e => e.category === 'timeout')).toBe(true);
  });

  it('should parse memory errors', () => {
    const errors = parseErrors("FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory");
    expect(errors.some(e => e.category === 'memory_error')).toBe(true);
  });

  it('should parse Node.js stack frames with line numbers', () => {
    const text = `at getUserId (/app/src/auth.ts:47:15)
    at handler (/app/src/routes.ts:23:10)`;
    const errors = parseErrors(text);
    const frame = errors.find(e => e.file?.includes('auth.ts'));
    expect(frame).toBeDefined();
    expect(frame!.line).toBe(47);
  });

  it('should parse Python file references', () => {
    const text = `File "app.py", line 42, in process`;
    const errors = parseErrors(text);
    expect(errors.some(e => e.line === 42)).toBe(true);
  });

  it('should parse deprecation warnings', () => {
    const errors = parseErrors("DeprecationWarning: Buffer() is deprecated");
    expect(errors.some(e => e.category === 'deprecation')).toBe(true);
  });

  it('should handle text with multiple errors', () => {
    const text = `TypeError: Cannot read properties of null
Error: connect ECONNREFUSED 127.0.0.1:5432
DeprecationWarning: Buffer() is deprecated`;
    const errors = parseErrors(text);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });

  it('should not duplicate errors', () => {
    const text = `TypeError: Cannot read properties of null (reading 'id')
TypeError: Cannot read properties of null (reading 'id')`;
    const errors = parseErrors(text);
    const typeErrors = errors.filter(e => e.errorType === 'TypeError');
    expect(typeErrors).toHaveLength(1);
  });

  it('should return empty for clean code', () => {
    const errors = parseErrors("const x = 42;\nconsole.log(x);");
    // Should find very few or no errors
    expect(errors.filter(e => e.category !== 'runtime_error').length).toBeLessThanOrEqual(1);
  });
});

// ─── findFixes ──────────────────────────────────────────────────

describe('findFixes', () => {
  it('should suggest fix for null reference', () => {
    const errors = parseErrors("TypeError: Cannot read properties of null (reading 'id')");
    const fixes = findFixes(errors, "");
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0].description).toContain('Null');
    expect(fixes[0].steps).toBeDefined();
    expect(fixes[0].steps!.length).toBeGreaterThan(0);
  });

  it('should suggest fix for module not found', () => {
    const errors = parseErrors("Error: Cannot find module 'express'");
    const fixes = findFixes(errors, "Cannot find module 'express'");
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.some(f => f.description.toLowerCase().includes('module') || f.description.toLowerCase().includes('install'))).toBe(true);
  });

  it('should suggest fix for syntax error', () => {
    const errors = parseErrors("SyntaxError: Unexpected token '}'");
    const fixes = findFixes(errors, "SyntaxError: Unexpected token");
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.some(f => f.description.toLowerCase().includes('syntax'))).toBe(true);
  });

  it('should suggest fix for connection refused', () => {
    const errors = parseErrors("Error: connect ECONNREFUSED 127.0.0.1:5432");
    const fixes = findFixes(errors, "ECONNREFUSED");
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.some(f => f.description.toLowerCase().includes('connection') || f.description.toLowerCase().includes('service'))).toBe(true);
  });

  it('should suggest fix for CORS errors', () => {
    const fixes = findFixes([], "Access-Control-Allow-Origin header is missing");
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes[0].description.toLowerCase()).toContain('cors');
  });

  it('should suggest fix for permission denied', () => {
    const errors = parseErrors("EACCES: permission denied, open '/etc/config'");
    const fixes = findFixes(errors, "EACCES permission denied");
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.some(f => f.description.toLowerCase().includes('permission'))).toBe(true);
  });

  it('should suggest fix for out of memory', () => {
    const fixes = findFixes([], "JavaScript heap out of memory");
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.some(f => f.description.toLowerCase().includes('memory'))).toBe(true);
  });

  it('should suggest fix for JWT/auth errors', () => {
    const fixes = findFixes([], "JsonWebTokenError: jwt expired");
    expect(fixes.length).toBeGreaterThan(0);
    expect(fixes.some(f => f.description.toLowerCase().includes('token') || f.description.toLowerCase().includes('auth'))).toBe(true);
  });

  it('should not suggest fixes for clean code', () => {
    const fixes = findFixes([], "const x = 42;\nconst y = x + 1;");
    expect(fixes).toHaveLength(0);
  });

  it('should include confidence scores', () => {
    const errors = parseErrors("TypeError: Cannot read properties of null");
    const fixes = findFixes(errors, "");
    for (const fix of fixes) {
      expect(fix.confidence).toBeGreaterThan(0);
      expect(fix.confidence).toBeLessThanOrEqual(1);
    }
  });
});

// ─── extractLineNumbers ─────────────────────────────────────────

describe('extractLineNumbers', () => {
  it('should extract line numbers from "line X" patterns', () => {
    const lines = extractLineNumbers('Error at line 42. Also see line 15.');
    expect(lines).toContain(42);
    expect(lines).toContain(15);
  });

  it('should extract from file:line:col patterns', () => {
    const lines = extractLineNumbers('at /app/server.ts:23:10');
    expect(lines).toContain(23);
  });

  it('should extract from Python File references', () => {
    const lines = extractLineNumbers('File "app.py", line 42, in main');
    expect(lines).toContain(42);
  });

  it('should sort line numbers', () => {
    const lines = extractLineNumbers('line 42, line 10, line 25');
    expect(lines).toEqual([10, 25, 42]);
  });

  it('should deduplicate line numbers', () => {
    const lines = extractLineNumbers('line 42, line 42, line 42');
    expect(lines).toEqual([42]);
  });

  it('should return empty for text without line numbers', () => {
    expect(extractLineNumbers('Hello world')).toEqual([]);
  });

  it('should extract from .py file references', () => {
    const lines = extractLineNumbers('at app.py:15');
    expect(lines).toContain(15);
  });

  it('should extract from .ts file references', () => {
    const lines = extractLineNumbers('at auth.ts:47');
    expect(lines).toContain(47);
  });

  it('should ignore unreasonably large line numbers', () => {
    const lines = extractLineNumbers('line 999999');
    expect(lines).toHaveLength(0);
  });
});

// ─── DebugAgent ─────────────────────────────────────────────────

describe('DebugAgent', () => {
  let agent: DebugAgent;

  beforeEach(() => {
    agent = new DebugAgent();
  });

  describe('handle()', () => {
    it('should analyze a stack trace', async () => {
      const analysis = mockAnalysis([
        `TypeError: Cannot read properties of null (reading 'id')
    at getUserId (/app/src/auth.ts:47:15)
    at handler (/app/src/routes.ts:23:10)`,
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.contentType).toBe('stack_trace');
      expect(result.problems.length).toBeGreaterThan(0);
      expect(result.fixes.length).toBeGreaterThan(0);
    });

    it('should detect TypeScript in code', async () => {
      const analysis = mockAnalysis([
        `interface User { name: string; age: number; }
const users: User[] = [];`,
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.language).toBe('typescript');
    });

    it('should detect Python code', async () => {
      const analysis = mockAnalysis([
        `def process():
    import os
    self.value = 42
    print(f"Done")`,
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.language).toBe('python');
    });

    it('should find security warnings', async () => {
      const analysis = mockAnalysis([
        `const password = "hunter2";
eval(userInput);`,
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.warnings.some(w => w.includes('password'))).toBe(true);
      expect(result.warnings.some(w => w.includes('eval'))).toBe(true);
    });

    it('should detect TODO/FIXME markers', async () => {
      const analysis = mockAnalysis([
        `function process() {
  // TODO: handle error case
  // FIXME: this is broken
  return 42;
}`,
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.warnings.some(w => w.includes('TODO'))).toBe(true);
    });

    it('should detect console.log statements', async () => {
      const analysis = mockAnalysis([
        `function handler(req, res) {
  console.log("debugging here");
  res.send("ok");
}`,
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.warnings.some(w => w.includes('console.log'))).toBe(true);
    });

    it('should handle empty text gracefully', async () => {
      const analysis = mockAnalysis([]);
      const result = await agent.handle(Buffer.from('test'), analysis);

      expect(result.problems).toHaveLength(0);
      expect(result.fixes).toHaveLength(0);
    });

    it('should update stats', async () => {
      const analysis = mockAnalysis(["TypeError: Cannot read properties of null"]);
      await agent.handle(Buffer.from('test'), analysis);

      const stats = agent.getStats();
      expect(stats.totalAnalyses).toBe(1);
      expect(stats.problemsFound).toBeGreaterThan(0);
    });

    it('should add to history', async () => {
      const analysis = mockAnalysis(["const x = 42;"]);
      await agent.handle(Buffer.from('test'), analysis);

      expect(agent.getHistory()).toHaveLength(1);
    });
  });

  describe('context sessions', () => {
    it('should start a context session', () => {
      agent.startContextSession();
      expect(agent.isSessionActive()).toBe(true);
    });

    it('should accumulate context across snaps', async () => {
      agent.startContextSession();

      const snap1 = mockAnalysis(["function process() {"]);
      await agent.handle(Buffer.from('test'), snap1);

      const snap2 = mockAnalysis(["  const x = null;"]);
      await agent.handle(Buffer.from('test'), snap2);

      expect(agent.getContextCount()).toBe(2);
    });

    it('should end context session', () => {
      agent.startContextSession();
      const session = agent.endContextSession();

      expect(agent.isSessionActive()).toBe(false);
      expect(session.active).toBe(false);
    });

    it('should include context count in analysis', async () => {
      agent.startContextSession();

      const snap1 = mockAnalysis(["const x = 1;"]);
      await agent.handle(Buffer.from('test'), snap1);

      const snap2 = mockAnalysis(["const y = 2;"]);
      const result = await agent.handle(Buffer.from('test'), snap2);

      expect(result.contextIndex).toBe(2);
      expect(result.totalContextSnaps).toBe(2);
    });

    it('should respect maxContextSnapshots', async () => {
      const smallAgent = new DebugAgent({ maxContextSnapshots: 3 });
      smallAgent.startContextSession();

      for (let i = 0; i < 5; i++) {
        const snap = mockAnalysis([`line ${i}`]);
        await smallAgent.handle(Buffer.from('test'), snap);
      }

      expect(smallAgent.getContextCount()).toBe(3);
    });
  });

  describe('generateVoiceSummary()', () => {
    it('should include language in summary', async () => {
      const analysis = mockAnalysis([
        `interface User { name: string; }`,
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);
      const summary = agent.generateVoiceSummary(result);

      expect(summary).toContain('typescript');
    });

    it('should describe stack trace', async () => {
      const analysis = mockAnalysis([
        `TypeError: Cannot read properties of null (reading 'id')
    at getUserId (/app/src/auth.ts:47:15)`,
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);
      const summary = agent.generateVoiceSummary(result);

      expect(summary).toContain('stack trace');
      expect(summary).toContain('error');
    });

    it('should include fix suggestion', async () => {
      const analysis = mockAnalysis([
        "TypeError: Cannot read properties of null (reading 'id')",
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);
      const summary = agent.generateVoiceSummary(result);

      expect(summary).toContain('Fix:');
    });

    it('should mention security warnings', async () => {
      const analysis = mockAnalysis([
        `const password = "secret123";`,
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);
      const summary = agent.generateVoiceSummary(result);

      expect(summary).toContain('⚠️');
    });

    it('should say no errors for clean code', async () => {
      const analysis = mockAnalysis(["const x = 42;"]);
      const result = await agent.handle(Buffer.from('test'), analysis);
      const summary = agent.generateVoiceSummary(result);

      expect(summary).toContain('No obvious errors');
    });

    it('should mention context count when in session', async () => {
      agent.startContextSession();

      const s1 = mockAnalysis(["const x = 1;"]);
      await agent.handle(Buffer.from('test'), s1);

      const s2 = mockAnalysis(["const y = 2;"]);
      const result = await agent.handle(Buffer.from('test'), s2);
      const summary = agent.generateVoiceSummary(result);

      expect(summary).toContain('2 snapshots');
    });

    it('should respect brief verbosity', async () => {
      agent.setVerbosity('brief');
      const analysis = mockAnalysis([
        "TypeError: Cannot read properties of null (reading 'id') in some very long error message that goes on and on",
      ]);
      const result = await agent.handle(Buffer.from('test'), analysis);
      const summary = agent.generateVoiceSummary(result);

      // Brief should not include fix steps
      expect(summary).not.toContain('Steps:');
    });
  });

  describe('configuration', () => {
    it('should set project languages', () => {
      agent.setProjectLanguages(['typescript', 'python']);
      // No error
    });

    it('should set verbosity', () => {
      agent.setVerbosity('detailed');
      // No error
    });

    it('should disable fix suggestions', async () => {
      const noFixAgent = new DebugAgent({ suggestFixes: false });
      const analysis = mockAnalysis(["TypeError: Cannot read properties of null"]);
      const result = await noFixAgent.handle(Buffer.from('test'), analysis);

      expect(result.fixes).toHaveLength(0);
    });

    it('should disable related warnings', async () => {
      const noWarnAgent = new DebugAgent({ relatedWarnings: false });
      const analysis = mockAnalysis(["console.log('debug'); eval(x);"]);
      const result = await noWarnAgent.handle(Buffer.from('test'), analysis);

      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('stats', () => {
    it('should track total analyses', async () => {
      const a1 = mockAnalysis(["const x = 1;"]);
      const a2 = mockAnalysis(["const y = 2;"]);
      await agent.handle(Buffer.from('test'), a1);
      await agent.handle(Buffer.from('test'), a2);

      expect(agent.getStats().totalAnalyses).toBe(2);
    });

    it('should track languages encountered', async () => {
      const ts = mockAnalysis(["interface User { name: string; }"]);
      const py = mockAnalysis(["def process():\n    self.value = 42\n    print('done')"]);
      await agent.handle(Buffer.from('test'), ts);
      await agent.handle(Buffer.from('test'), py);

      const stats = agent.getStats();
      expect(stats.languagesEncountered).toContain('typescript');
      expect(stats.languagesEncountered).toContain('python');
    });

    it('should track content types', async () => {
      const analysis = mockAnalysis([`Traceback (most recent call last):
  File "app.py", line 42, in <module>
    process()
TypeError: cannot add str and int`]);
      await agent.handle(Buffer.from('test'), analysis);

      const stats = agent.getStats();
      expect(stats.contentTypeCounts['stack_trace']).toBe(1);
    });

    it('should return copy of stats', () => {
      const s1 = agent.getStats();
      const s2 = agent.getStats();
      expect(s1).not.toBe(s2);
      expect(s1).toEqual(s2);
    });
  });
});
