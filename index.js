import { chromium } from "playwright";
import fetch from "node-fetch";
import fs from "fs";

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const START_URL = "https://reservation-cf.frontdeskqms.ca/rcfs/cardelrec/Home/Index?Culture=en&PageId=a10d1358-60a7-46b6-b5e9-5b990594b108&ShouldStartReserveTimeFlow=False&ButtonId=00000000-0000-0000-0000-000000000000";

const STATE_FILE = "./state.json";

const now = new Date();
const est = new Date(now.toLocaleString("en-US", { timeZone: "America/Toronto" }));

const day = est.getDay();
const hour = est.getHours();

if (!(day === 2 && hour >= 18)) {
    process.exit(0);
}

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return { status: "FULL" };
    return JSON.parse(fs.readFileSync(STATE_FILE));
}

function saveState(status) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ status }));
}

async function notifyDiscord() {
    await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        content:
            "CARDELREC Volleyball (Thursday 7:45–9:45 PM) is OPEN!"
        }),
    });
}

async function check() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();

    await page.goto(START_URL, { waitUntil: "domcontentloaded" });
    await page.getByText("Volleyball - adult", { exact: true }).click();
    await page.waitForLoadState("domcontentloaded");

    const body = await page.locator("body").innerText();
    const isFull = body.includes("No more available time slots");

    await browser.close();

    const currentStatus = isFull ? "FULL" : "AVAILABLE";
    const previous = loadState().status;
  
    const now = new Date().toLocaleString("en-US", {
        timeZone: "America/Toronto"
    });

    await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        content: `Sanity Check:
            Status: ${currentStatus}
            Time: ${now}`
        })
    });

    saveState(currentStatus);
}

check();
