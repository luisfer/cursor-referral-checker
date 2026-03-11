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

const USED_MESSAGE = "Sorry, this code has already been used";
const CONCURRENCY = 3;
const NAV_TIMEOUT = 15000;
const RENDER_DELAY = 1200;
const OUTPUT_PATH = "dist.txt";

async function checkUrl(context, url) {
  const page = await context.newPage();
  try {
    const res = await page.goto(url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT });
    if (!res?.ok()) return { url, status: "error", error: `HTTP ${res?.status()}` };

    await page.waitForTimeout(RENDER_DELAY);

    const body = await page.locator("body").textContent();
    const isUsed = body?.includes(USED_MESSAGE) ?? false;

    return { url, status: isUsed ? "used" : "available" };
  } catch (e) {
    return { url, status: "error", error: e.message };
  } finally {
    await page.close();
  }
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
    const results = [];
    let completed = 0;

    // Process URLs in batches
    for (let i = 0; i < urls.length; i += CONCURRENCY) {
      const batch = urls.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map((url) => checkUrl(context, url))
      );

      for (const r of batchResults) {
        completed++;
        results.push(r);
        const icon = r.status === "used" ? "✗" : r.status === "available" ? "✓" : "?";
        console.log(`[${completed}/${total}] ${icon} ${r.url} → ${r.status}${r.error ? ` (${r.error})` : ""}`);
      }
    }

    const used = results.filter((r) => r.status === "used");
    const available = results.filter((r) => r.status === "available");
    const errors = results.filter((r) => r.status === "error");

    console.log("\n--- Summary ---");
    console.log(`Used: ${used.length} | Available: ${available.length} | Errors: ${errors.length}`);

    if (available.length > 0) {
      fs.writeFileSync(OUTPUT_PATH, available.map((r) => r.url).join("\n") + "\n", "utf8");
      console.log(`\nAvailable URLs written to ${OUTPUT_PATH}`);
    }

    if (errors.length > 0) process.exit(2);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
