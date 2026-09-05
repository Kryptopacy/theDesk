// Hash-chained, append-only audit log (JSONL). Each event commits to the previous hash,
// so any retro-edit breaks the chain — this is what makes the fund's history tamper-evident.
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stable(value[k])).join(",") + "}";
}

const digest = (s) => createHash("sha256").update(s).digest("hex");

export class AuditLog {
  constructor(path) {
    this.path = path;
    this.seq = 0;
    this.prev = "GENESIS";
    if (existsSync(path)) {
      for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
        const e = JSON.parse(line);
        this.seq = e.seq;
        this.prev = e.hash;
      }
    }
  }

  append(event, data) {
    this.seq += 1;
    const ts = new Date().toISOString();
    const hash = digest(this.prev + stable({ seq: this.seq, ts, event, data }));
    const entry = { seq: this.seq, ts, event, data, prev: this.prev, hash };
    appendFileSync(this.path, JSON.stringify(entry) + "\n");
    this.prev = hash;
    return entry;
  }

  verify() {
    const lines = readFileSync(this.path, "utf8").split("\n").filter(Boolean);
    let prev = "GENESIS";
    for (const line of lines) {
      const e = JSON.parse(line);
      const expect = digest(prev + stable({ seq: e.seq, ts: e.ts, event: e.event, data: e.data }));
      if (e.prev !== prev || e.hash !== expect) return { ok: false, broken_at: e.seq };
      prev = e.hash;
    }
    return { ok: true, events: lines.length };
  }
}
