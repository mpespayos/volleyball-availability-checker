import { chromium } from "playwright";
import fetch from "node-fetch";

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

// This is your "select a time" URL for the volleyball flow.
// Keep it as-is (pageId stable; buttonId might be stable for the activity).
const TIME_SELECTION_URL =
    "https://reservation-cf.frontdeskqms.ca/rcfs/cardelrec/ReserveTime/TimeSelection?pageId=a10d1358-60a7-46b6-b5e9-5b990594b108&buttonId=4e2cb130-8d89-4cd2-a350-9adc29455241&culture=en";

function inferStatus(finalUrl, bodyText) {
    if (finalUrl.includes("/SlotCountSelection")) return "AVAILABLE";
    if (bodyText.includes("No more available time slots")) return "FULL";
    // If it stays on TimeSelection but doesn't show the "full" text, it might still be available
    // but requires expanding a date row, or the site changed. Mark as UNKNOWN and include URL.
    if (finalUrl.includes("/TimeSelection")) return "FULL";
    return "UNKNOWN";
}

async function postDiscord(message) {
    await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message })
    });
}

async function check() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    page.setDefaultTimeout(60000);

    await page.goto(TIME_SELECTION_URL, { waitUntil: "load" });

    // Give any redirects a moment to happen
    await page.waitForTimeout(1500);

    const finalUrl = page.url();
    const bodyText = await page.locator("body").innerText();

    const status = inferStatus(finalUrl, bodyText);

    await browser.close();

    const torontoTime = new Date().toLocaleString("en-US", {
        timeZone: "America/Toronto"
    });

    const msg =
        `CARDELREC Volleyball (Thu 7:45–9:45)\n` +
        `Status: ${status}\n` +
        `Final URL: ${finalUrl}\n` +
        `Checked: ${torontoTime}`;

    await postDiscord(msg);
    console.log(msg);
}

check();

