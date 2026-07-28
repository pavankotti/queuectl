# QueueCTL — CLI Background Job Queue System

QueueCTL is a production-grade, lightweight CLI background job queue system built in **Node.js**. It features atomic job claiming across multiple OS processes, automatic exponential backoff retries, a Dead Letter Queue (DLQ) for permanently failed jobs, graceful worker shutdown, and SIGKILL crash recovery (< 60s).

---

## 🚀 Quick Start

### 1. Installation & Linking
Clone the repository, install dependencies, and link the binary globally:
```bash
npm install
npm link
```

After running `npm link`, you can run `queuectl` directly from any terminal prompt!

---

### 2. Usage Examples

#### Enqueue Jobs
```bash
queuectl enqueue '{"id":"job1","command":"echo Hello World"}'
queuectl enqueue '{"id":"job2","command":"sleep 2"}'
```

#### Start Workers
Start worker process(es) in the foreground (blocks until stopped):
```bash
queuectl worker start --count 3
```

#### Stop Workers Gracefully
From another terminal:
```bash
queuectl worker stop
```

#### Check System Status & List Jobs
```bash
queuectl status
queuectl list --state pending
queuectl list --state pending --json
```

#### Dead Letter Queue (DLQ) Management
```bash
queuectl dlq list
queuectl dlq retry job1
```

#### Configuration Management
```bash
queuectl config set max-retries 3
queuectl config set backoff-base 2
```

---

## 🏗 Architecture Overview

```
queuectl/
├── src/
│   ├── index.js          # Executable CLI entry point & commands
│   ├── database.js       # SQLite connection, atomic claim & queries
│   ├── worker.js         # Worker loop, execution & crash recovery
│   └── ui.js             # Welcome ASCII gradient banner
├── package.json          # Package configuration ("bin": { "queuectl": "./src/index.js" })
├── DECISIONS.md          # Architectural decision explanations
└── test-scenarios.js     # Verification suite for Scenarios 1–5
```

---

## 🧪 Automated Verification

Run the full end-to-end automated test suite for Scenarios 1–5:
```bash
npm test
```
