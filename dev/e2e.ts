// End-to-end check with a real browser at iPhone size. Needs the dev server running (tsx dev/dev-server.ts).
// Usage: tsx dev/e2e.ts <path-to-pdf> [outDir]
import { chromium, devices } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:8788";
const PDF = process.argv[2];
const OUT = process.argv[3] ?? "/tmp/dyala-shots";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a: unknown[]) => console.log("•", ...a);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices["iPhone 13"], locale: "ar" });
const page = await ctx.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("requestfailed", (r) => errors.push("requestfailed: " + r.url()));
const shot = (n: string) => page.screenshot({ path: path.join(OUT, n + ".png") });

// --- admin: login + upload
await page.goto(BASE + "/");
await page.waitForSelector("form.login-card");
await shot("01-login");
await page.fill('input[autocomplete="username"]', "ahmed");
await page.fill('input[type="password"]', "admin-pass-123");
await page.click("button.btn.primary");
await page.waitForSelector(".admin", { timeout: 10000 });
log("admin logged in");
await page.locator('input[type="file"]').setInputFiles(PDF);
await page.waitForSelector(".item .fields");
await page.fill('.fields textarea', "يا ديالا، هاد الكتاب لإلك. بالتوفيق!");
await page.fill('.fields input[placeholder^="المادة"]', "Economics");
const t0 = Date.now();
await page.click("text=رفع الكتب");
await page.waitForSelector(".item.done, .item.error", { timeout: 240000 });
log("upload finished in", ((Date.now() - t0) / 1000).toFixed(1), "s ->", await page.locator(".item").first().innerText().then((t) => t.replace(/\n/g, " | ")));
await page.waitForSelector(".admin-list li");
await shot("02-admin-after-upload");

// --- reader account
await page.request.post(BASE + "/api/logout", { data: {} });
await page.goto(BASE + "/");
await page.waitForSelector("form.login-card");
await page.fill('input[autocomplete="username"]', "dyala");
await page.fill('input[type="password"]', "dyala-pass-123");
await page.click("button.btn.primary");
await page.waitForSelector(".card");
log("dyala logged in, books:", await page.locator(".card").count());
await shot("03-library");

// --- open the book: personal note, render, navigate
await page.click(".card-main");
await page.waitForSelector(".note", { timeout: 120000 });
await shot("04-note");
await page.click(".note .btn");
await page.waitForFunction(() => { const c = document.querySelector<HTMLCanvasElement>(".r-stage canvas"); return c && c.width > 100 && !c.classList.contains("hidden"); }, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await shot("05-reader-page1");
const dims = await page.evaluate(() => { const c = document.querySelector<HTMLCanvasElement>(".r-stage canvas")!; return `${c.width}x${c.height} css ${c.style.width}`; });
log("canvas", dims);

await page.fill(".r-page input", "40");
await page.waitForTimeout(1800);
await shot("06-reader-page40");
await page.click('button[aria-label="علامة"]');
await page.click('button[aria-label="تغيير الثيم"]');
await page.waitForTimeout(400);
await page.click('button[aria-label="تغيير الثيم"]');
await page.waitForTimeout(1200);
await shot("07-reader-dark");
await page.click('button[aria-label="تغيير الثيم"]');

// search inside the book
await page.click('button[aria-label="بحث في الكتاب"]');
await page.fill(".sheet input", "elasticity");
await page.waitForSelector(".sheet .hits li", { timeout: 10000 });
log("search hits:", await page.locator(".sheet .hits li").count());
await shot("08-search");
await page.locator(".sheet .hits li button").first().click();
await page.waitForTimeout(1500);
const pageNow = await page.inputValue(".r-page input");
log("jumped to page", pageNow);

// progress persisted?
await page.waitForTimeout(2500);
await page.click('button[aria-label="رجوع"]');
await page.waitForSelector(".card");
await page.waitForTimeout(500);
await shot("09-library-progress");
log("progress text:", await page.locator(".card-foot").first().innerText().then((t) => t.replace(/\n/g, " ")));

// offline: reopen from IndexedDB with the network cut
await ctx.setOffline(true);
await page.reload().catch(() => {});
await page.waitForTimeout(1500);
log("offline reload shows:", await page.locator("body").innerText().then((t) => t.slice(0, 80).replace(/\n/g, " ")));
await ctx.setOffline(false);

console.log(errors.length ? "ERRORS:\n" + [...new Set(errors)].join("\n") : "no browser errors");
await browser.close();
