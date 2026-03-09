// index.js
import "dotenv/config";
import cron from "node-cron";
import { chromium } from "playwright";
import { CENTRES } from "./config.js";

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL?.trim();
const CHECK_EVERY_SECONDS = Number(process.env.CHECK_EVERY_SECONDS ?? "30");
const HEADLESS = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";

let lastAvailable = false;

async function sendDiscord(message) {
    if (!WEBHOOK) return;
    try {
        await fetch(WEBHOOK, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: message }),
        });
    } catch (e) {
        console.error("Discord webhook failed:", e?.message ?? e);
    }
}

function sanitizeFilename(s) {
    return s.replace(/\W+/g, "_");
}

async function acceptCookiesIfPresent(page) {
    const btn = page.getByRole("button", { name: /accept necessary cookies/i });
    if (await btn.count()) {
        try {
            await btn.first().click({ timeout: 1500 });
            await page.waitForTimeout(500);
        } catch { }
    }
}

async function proceedPastGroupSizeIfPresent(page) {
    const groupSizeHeading = page.getByRole("heading", { name: /group size/i });
    if (!(await groupSizeHeading.count())) return;

    // Fill 1 (usually already)
    try {
        await page.locator("input").first().fill("1");
    } catch { }

    const confirmBtn = page.getByRole("button", { name: /confirm/i });
    if (await confirmBtn.count()) {
        await confirmBtn.first().click({ timeout: 3000 });
        await page.waitForTimeout(2000);
    }
}

// AVAILABLE if at least one date block does NOT show "No more available time slots"
async function detectAvailableByWarningBlocks(page) {
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    await acceptCookiesIfPresent(page);
    await proceedPastGroupSizeIfPresent(page);
    await page.waitForTimeout(1500);

    // Expand date blocks (safe even if already expanded)
    const headers = page.locator(".date.one-queue > a.title, .date.one-queue a.title");
    const n = await headers.count();
    for (let i = 0; i < n; i++) {
        try {
            await headers.nth(i).click({ timeout: 800 });
            await page.waitForTimeout(250);
        } catch { }
    }

    const available = await page.evaluate(() => {
        const blocks = Array.from(document.querySelectorAll(".date.one-queue"));
        if (blocks.length === 0) return false;

        const blockIsFull = (block) => {
            const msg = block.querySelector(".warning-message span");
            const text = (msg?.textContent || "").trim().toLowerCase();
            return text.includes("no more available time slots");
        };

        const fullCount = blocks.filter(blockIsFull).length;
        return fullCount < blocks.length; // any non-full block => available
    });

    return available;
}

async function checkOnce(browser) {
    const centre = CENTRES[0];

    const context = await browser.newContext({
        locale: "en-CA",
        timezoneId: "America/Toronto",
        extraHTTPHeaders: { "Accept-Language": "en-CA,en;q=0.9" },
    });

    const page = await context.newPage();

    try {
        await page.goto(centre.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(2000);

        // optional screenshots
        // await page.screenshot({ path: `screenshots/${sanitizeFilename(centre.name)}.png`, fullPage: true });

        const available = await detectAvailableByWarningBlocks(page);

        const status = available ? "AVAILABLE" : "FULL";
        console.log(`${centre.name} | ${status}`);

        // Notify on state changes BOTH ways
        if (available !== lastAvailable) {
            if (available) {
                await sendDiscord(`🏐 **AVAILABLE:** ${centre.name}`);
            } else {
                await sendDiscord(`⛔ **FULL:** ${centre.name}`);
            }
            lastAvailable = available;
        }

        await context.close();
    } catch (e) {
        await context.close();
        console.log(`${centre.name} | ERROR`);
    }
}

async function main() {
    const browser = await chromium.launch({ headless: HEADLESS });

    await checkOnce(browser);

    const expr = `*/${Math.max(1, CHECK_EVERY_SECONDS)} * * * * *`;
    cron.schedule(expr, async () => {
        await checkOnce(browser);
    });

    console.log(`\nChecking every ${CHECK_EVERY_SECONDS}s (headless=${HEADLESS})`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
