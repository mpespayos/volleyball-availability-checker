import "dotenv/config";
import { chromium } from "playwright";
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { CENTRES } from "./config.js";

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL?.trim();
const HEADLESS = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";
const STATE_FILE = process.env.STATE_FILE ?? "./gha-state.json";

async function sendDiscord(message) {
  if (!WEBHOOK) {
    throw new Error("DISCORD_WEBHOOK_URL is missing.");
  }

  const response = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: message }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed: ${response.status} ${text}`);
  }
}

async function loadState() {
  if (!existsSync(STATE_FILE)) return {};

  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveState(state) {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function acceptCookiesIfPresent(page) {
  const btn = page.getByRole("button", { name: /accept necessary cookies/i });
  if (await btn.count()) {
    try {
      await btn.first().click({ timeout: 1500 });
      await page.waitForTimeout(500);
    } catch {}
  }
}

async function proceedPastGroupSizeIfPresent(page) {
  const groupSizeHeading = page.getByRole("heading", { name: /group size/i });
  if (!(await groupSizeHeading.count())) return;

  try {
    await page.locator("input").first().fill("1");
  } catch {}

  const confirmBtn = page.getByRole("button", { name: /confirm/i });
  if (await confirmBtn.count()) {
    await confirmBtn.first().click({ timeout: 3000 });
    await page.waitForTimeout(2000);
  }
}

async function detectAvailableByWarningBlocks(page) {
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(1500);

  await acceptCookiesIfPresent(page);
  await proceedPastGroupSizeIfPresent(page);
  await page.waitForTimeout(1500);

  const headers = page.locator(".date.one-queue > a.title, .date.one-queue a.title");
  const n = await headers.count();
  for (let i = 0; i < n; i++) {
    try {
      await headers.nth(i).click({ timeout: 800 });
      await page.waitForTimeout(250);
    } catch {}
  }

  return await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll(".date.one-queue"));
    if (blocks.length === 0) return false;

    const blockIsFull = (block) => {
      const msg = block.querySelector(".warning-message span");
      const text = (msg?.textContent || "").trim().toLowerCase();
      return text.includes("no more available time slots");
    };

    const fullCount = blocks.filter(blockIsFull).length;
    return fullCount < blocks.length;
  });
}

async function checkCentre(browser, centre, state) {
  const context = await browser.newContext({
    locale: "en-CA",
    timezoneId: "America/Toronto",
    extraHTTPHeaders: { "Accept-Language": "en-CA,en;q=0.9" },
  });

  const page = await context.newPage();

  try {
    await page.goto(centre.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);

    const available = await detectAvailableByWarningBlocks(page);
    const previous = state[centre.url]?.available;
    const status = available ? "AVAILABLE" : "FULL";

    console.log(`${centre.name} | ${status}`);

    if (previous === undefined) {
      await sendDiscord(`ℹ️ Initial check: **${status}** for ${centre.name}`);
    } else if (available !== previous) {
      await sendDiscord(
        available
          ? `🏐 **AVAILABLE:** ${centre.name}`
          : `⛔ **FULL:** ${centre.name}`
      );
    }

    state[centre.url] = {
      name: centre.name,
      url: centre.url,
      available,
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    console.error(`${centre.name} | ERROR`, error?.message ?? error);
  } finally {
    await context.close();
  }
}

async function main() {
  const state = await loadState();
  const browser = await chromium.launch({ headless: HEADLESS });

  try {
    for (const centre of CENTRES) {
      await checkCentre(browser, centre, state);
    }
  } finally {
    await browser.close();
    await saveState(state);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
