// Checks the chapters list (PDF outline) in a real browser at iPhone size.
// Usage: tsx dev/e2e-toc.ts <pdf> <expected-chapter-title-fragment> [outDir]   (dev server must be running)
import { chromium, devices } from "playwright";
import path from "node:path";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:8788";
const [PDF, WANT, OUT = "/tmp/dyala-toc"] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ ...devices["iPhone 13"], locale: "ar" })).newPage();
const login = async (u: string, p: string) => {
  await page.goto(BASE + "/");
  await page.waitForSelector("form.login-card");
  await page.fill('input[autocomplete="username"]', u);
  await page.fill('input[type="password"]', p);
  await page.click("button.btn.primary");
};
await login("ahmed", "admin-pass-123");
await page.waitForSelector(".admin");
await page.locator('input[type="file"]').setInputFiles(PDF);
await page.waitForSelector(".item .fields");
await page.click("text=رفع الكتب");
await page.waitForSelector(".item.done, .item.error", { timeout: 240000 });
await page.request.post(BASE + "/api/logout", { data: {} });
await login("dyala", "dyala-pass-123");
await page.waitForSelector(".card");
await page.locator(".card-main").last().click();
await page.waitForFunction(() => document.querySelector(".note, .r-stage canvas"), null, { timeout: 120000 });
if (await page.locator(".note .btn").count()) await page.click(".note .btn");
await page.waitForFunction(() => { const c = document.querySelector<HTMLCanvasElement>(".r-stage canvas"); return c && c.width > 100 && !c.classList.contains("hidden"); }, null, { timeout: 60000 });
await page.waitForSelector('button.chip:has-text("الفصول")', { timeout: 15000 });
await page.click('button.chip:has-text("الفصول")');
await page.waitForSelector(".row.toc");
const rows = await page.locator(".row.toc").allInnerTexts();
console.log("chapters:", rows.length);
console.log(rows.slice(0, 14).map((r) => "  " + r.replace(/\n/g, " | ")).join("\n"));
await page.screenshot({ path: path.join(OUT, "toc.png") });
const target = page.locator(".row.toc", { hasText: WANT }).first();
const pageNo = (await target.innerText()).match(/(\d+)(?:–\d+)?\s*$/)?.[1];
await target.click();
await page.waitForTimeout(2500);
const shown = await page.inputValue('input[aria-label="رقم الصفحة"]');
const chap = await page.locator(".r-chap").innerText().catch(() => "");
console.log(`clicked "${WANT}" -> expected page ${pageNo}, reader shows page ${shown}, header chapter: "${chap}"`);
await page.screenshot({ path: path.join(OUT, "after-jump.png") });
await browser.close();
if (!rows.length || pageNo !== shown) { console.log("FAIL"); process.exit(1); }
console.log("OK");
