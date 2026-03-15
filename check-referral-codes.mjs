#!/usr/bin/env node
/**
 * Check Cursor referral URLs for "Sorry, this code has already been used"
 * Usage: node check-referral-codes.mjs [url1] [url2] ...
 * Or: node check-referral-codes.mjs < urls.txt
 *
 * Requires: npx playwright install chromium (first run)
 */

import fs from "fs";
import { chromium } from "playwright";

const CONCURRENCY = 3;
const NAV_TIMEOUT = 30000;
const RENDER_DELAY = 2500;
const RETRY_DELAY = 8000;
const RETRY_CONCURRENCY = 1;
const MAX_RETRIES = 2;
const OUTPUT_PATH = "dist.txt";
const CSV_OUTPUT_PATH = "dist.csv";

const USED_PATTERNS = [
  /already been (used|redeemed|claimed)/i,
  /code.{0,20}(expired|invalid|used|redeemed|claimed)/i,
  /no longer (valid|available|active)/i,
];

const INVALID_PATTERNS = [
  /couldn.t (use|find|apply|verify)/i,
  /couldn.t find that referral/i,
  /code.{0,10}(not found|does not exist|doesn.t exist)/i,
  /invalid.{0,10}(code|referral|link)/i,
];

const AVAILABLE_PATTERNS = [
  /received a \$[\d,.]+\s*credit/i,
  /\$[\d,.]+\s*credit.{0,20}(applied|added|received)/i,
  /credit.{0,20}(applied|added|will.{0,10}be)/i,
  /welcome.{0,20}cursor/i,
];

function matchFirst(body, patterns) {
  for (const p of patterns) {
    const m = body.match(p);
    if (m) return m[0];
  }
  return null;
}

function classifyPage(body) {
  if (!body) return { status: "error", message: "Empty page body" };

  const used = matchFirst(body, USED_PATTERNS);
  if (used) return { status: "used", message: used };

  const invalid = matchFirst(body, INVALID_PATTERNS);
  if (invalid) return { status: "invalid", message: invalid };

  const available = matchFirst(body, AVAILABLE_PATTERNS);
  if (available) return { status: "available", message: available };

  const cleaned = body.replace(/\(\(a,b,c.*?\)\).*?true\)/, "").trim();
  const snippet = cleaned.substring(0, 120).replace(/\s+/g, " ").trim();
  return { status: "unknown", message: snippet || "Could not parse page" };
}

async function checkUrl(context, url, renderDelay = RENDER_DELAY) {
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    if (!res?.ok()) return { url, status: "error", message: `HTTP ${res?.status()}` };

    await page.waitForTimeout(renderDelay);

    const body = await page.locator("body").textContent();
    const { status, message } = classifyPage(body);

    return { url, status, message };
  } catch (e) {
    return { url, status: "error", message: e.message };
  } finally {
    await page.close();
  }
}

async function processBatch(context, urls, concurrency, renderDelay, label, logOffset = 0) {
  const results = [];
  let completed = 0;
  const total = urls.length;

  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((url) => checkUrl(context, url, renderDelay))
    );

    for (const r of batchResults) {
      completed++;
      results.push(r);
      const icons = { used: "✗", available: "✓", invalid: "⚠", error: "?", unknown: "?" };
      const icon = icons[r.status] ?? "?";
      console.log(`${label}[${completed}/${total}] ${icon} ${r.url} → ${r.status} | ${r.message}`);
    }
  }

  return results;
}

async function main() {
  let urls = process.argv.slice(2).filter((a) => !a.startsWith("--"));

  if (urls.length === 0) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const input = Buffer.concat(chunks).toString();
    urls = input
      .split(/\r?\n/)
      .filter((line) => line.trim() && !line.trim().startsWith("#"))
      .map((line) => {
        const url = line.trim().split(",").find((c) => c.trim().startsWith("http"));
        return url ? url.trim() : null;
      })
      .filter((u) => u && u.startsWith("http"));
  }

  // Deduplicate
  const before = urls.length;
  urls = [...new Set(urls)];
  if (urls.length < before) {
    console.log(`Removed ${before - urls.length} duplicate URL${before - urls.length > 1 ? "s" : ""}.`);
  }

  if (urls.length === 0) {
    console.log("Usage: node check-referral-codes.mjs <url1> [url2] ...");
    console.log("   Or: node check-referral-codes.mjs < urls.txt");
    process.exit(1);
  }

  const total = urls.length;
  console.log(`Checking ${total} URL${total > 1 ? "s" : ""} (concurrency: ${CONCURRENCY})...\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();

  try {
    let results = await processBatch(context, urls, CONCURRENCY, RENDER_DELAY, "");

    // Segunda pasada: retry unknowns with longer wait and lower concurrency
    for (let retry = 1; retry <= MAX_RETRIES; retry++) {
      const unknowns = results.filter((r) => r.status === "unknown");
      if (unknowns.length === 0) break;

      const delay = RETRY_DELAY * retry;
      console.log(`\n--- Segunda pasada ${retry}/${MAX_RETRIES}: retrying ${unknowns.length} unknown codes (wait: ${delay}ms, concurrency: ${RETRY_CONCURRENCY}) ---\n`);

      const retryUrls = unknowns.map((r) => r.url);
      const retryResults = await processBatch(context, retryUrls, RETRY_CONCURRENCY, delay, `[retry ${retry}]`);

      const retryMap = new Map(retryResults.map((r) => [r.url, r]));
      results = results.map((r) => retryMap.get(r.url) ?? r);
    }

    const used = results.filter((r) => r.status === "used");
    const available = results.filter((r) => r.status === "available");
    const invalid = results.filter((r) => r.status === "invalid");
    const errors = results.filter((r) => r.status === "error");
    const unknown = results.filter((r) => r.status === "unknown");

    console.log("\n--- Final Summary ---");
    console.log(`Used: ${used.length} | Available: ${available.length} | Invalid: ${invalid.length} | Errors: ${errors.length} | Unknown: ${unknown.length}`);

    if (available.length > 0) {
      fs.writeFileSync(OUTPUT_PATH, available.map((r) => r.url).join("\n") + "\n", "utf8");
      console.log(`\nAvailable URLs written to ${OUTPUT_PATH}`);
    }

    const csvHeader = "url,status,message";
    const csvRows = results.map((r) => {
      const escaped = r.message.replace(/"/g, '""');
      return `${r.url},${r.status},"${escaped}"`;
    });
    fs.writeFileSync(CSV_OUTPUT_PATH, [csvHeader, ...csvRows].join("\n") + "\n", "utf8");
    console.log(`Full results with messages written to ${CSV_OUTPUT_PATH}`);

    if (errors.length > 0) process.exit(2);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
