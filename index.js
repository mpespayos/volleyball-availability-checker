import { chromium } from "playwright";
import fetch from "node-fetch";

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

const START_URL =
    "https://reservation-cf.frontdeskqms.ca/rcfs/cardelrec/Home/Index?Culture=en&PageId=a10d1358-60a7-46b6-b5e9-5b990594b108&ShouldStartReserveTimeFlow=False&ButtonId=00000000-0000-0000-0000-000000000000";

async function check() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();

    // Give slow cloud loads more time
    page.setDefaultTimeout(60000);

    await page.goto(START_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle");

    // Robust selector (handles -, –, — and spacing)
    const volleyballTile = page.locator("text=/volleyball\\s*[-–—]\\s*adult/i").first();
    await volleyballTile.waitFor({ state: "visible" });
    await volleyballTile.click();

    await page.waitForLoadState("networkidle");

    const body = await page.locator("body").innerText();
    const isFull = body.includes("No more available time slots");
    const status = isFull ? "FULL" : "AVAILABLE";

    await browser.close();

    const torontoTime = new Date().toLocaleString("en-US", {
        timeZone: "America/Toronto"
    });

    await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            content: `CARDELREC Volleyball (Thu 7:45–9:45 PM)\nStatus: ${status}\nChecked: ${torontoTime}`
        })
    });

    console.log("Posted status:", status);
}

check();
