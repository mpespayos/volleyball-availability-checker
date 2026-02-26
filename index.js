import { chromium } from "playwright";
import fetch from "node-fetch";
import fs from "fs";

const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;
const SANITY_CHECK = process.env.SANITY_CHECK === "1";

const START_URL =
"https://reservation-cf.frontdeskqms.ca/rcfs/cardelrec/Home/Index?Culture=en&PageId=a10d1358-60a7-46b6-b5e9-5b990594b108&ShouldStartReserveTimeFlow=False&ButtonId=00000000-0000-0000-0000-000000000000";

const TILE_TEXT = "Volleyball - adult";
const STATE_FILE = "state.json";

function nowToronto() {
    return new Date().toLocaleString("en-US", { timeZone: "America/Toronto" });
}

function loadState() {
    if (!fs.existsSync(STATE_FILE)) return { status: "FULL" };
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    } catch {
        return { status: "FULL" };
    }
}

function saveState(status) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ status }), "utf8");
}

async function postDiscord(content) {
    if (!DISCORD_WEBHOOK) {
        throw new Error(
        "DISCORD_WEBHOOK env var is missing. Check repo secret name and workflow env mapping."
        );
    }

    const r = await fetch(DISCORD_WEBHOOK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
    });

    console.log("Discord webhook HTTP status:", r.status);
    if (!r.ok) {
        const text = await r.text().catch(() => "");
        console.log("Discord response body:", text);
        throw new Error(`Discord webhook failed: ${r.status}`);
    }
}

async function checkAvailability() {
    const browser = await chromium.launch({ args: ["--no-sandbox"] });
    const page = await browser.newPage();
    
    await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    });
    
    console.log(`[${nowToronto()}] Visiting grid page...`);
    await page.goto(START_URL, { waitUntil: "networkidle", timeout: 60000 });
    console.log(`[${nowToronto()}] Grid URL: ${page.url()}`);
    
    console.log(`[${nowToronto()}] Looking for volleyball tile...`);
    
    const tile = page.getByText(/Volleyball\s*-\s*adult/i).first();
    
    const found = await tile.isVisible({ timeout: 45000 }).catch(() => false);
    
    if (!found) {
        console.log(`[${nowToronto()}] Tile not found. Taking screenshot for debugging...`);
        await page.screenshot({ path: "debug-grid.png", fullPage: true });
        await browser.close();
        throw new Error(
            "Could not find 'Volleyball - adult' tile on grid page (see debug-grid.png artifact)."
        );
    }
    
    console.log(`[${nowToronto()}] Clicking volleyball tile...`);
    await tile.click({ timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 60000 });
    
    console.log(`[${nowToronto()}] Landed on: ${page.url()}`);
    
    const body = await page.locator("body").innerText();
    const isFull = body.includes("No more available time slots");
    
    await browser.close();
    return isFull ? "FULL" : "AVAILABLE";
}

async function main() {
    console.log("=== Cardelrec Checker Start ===");
    console.log("Time (Toronto):", nowToronto());
    console.log("SANITY_CHECK:", SANITY_CHECK ? "ON" : "OFF");

    const status = await checkAvailability();
    console.log("Detected status:", status);

    const prev = loadState().status;
    console.log("Previous status:", prev);

    if (SANITY_CHECK) {
        await postDiscord(
        `✅ Sanity check from GitHub Actions\nStatus: ${status}\nTime: ${nowToronto()}`
        );
    } else {
        if (status === "AVAILABLE" && prev === "FULL") {
        await postDiscord(
            `🔥 CARDELREC Volleyball (Thursday 7:45–9:45 PM) is OPEN!\nTime: ${nowToronto()}\nTry booking now:\n${START_URL}`
        );
        } else {
        console.log("No notification sent (no FULL→AVAILABLE transition).");
        }
    }

    saveState(status);
    console.log("Saved state:", status);
    console.log("=== Done ===");
}

main().catch((err) => {
    console.error("FATAL:", err);
    process.exit(1);
});

