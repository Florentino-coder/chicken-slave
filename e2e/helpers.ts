import { Browser, BrowserContextOptions, Page, expect } from '@playwright/test';

export const THREE_OF_CLUBS = 0;

/** Opens a fresh guest (own browser context = own cookie) on the home page. */
export async function newGuest(browser: Browser, opts: BrowserContextOptions = {}): Promise<Page> {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'สร้างห้อง' })).toBeEnabled();
  return page;
}

export async function setHomeName(page: Page, name: string) {
  await page.locator('#name').fill(name);
}

/** Creates a room from the home page and returns its code. */
export async function createRoom(page: Page, opts: { name?: string; password?: string } = {}): Promise<string> {
  if (opts.name) await setHomeName(page, opts.name);
  if (opts.password) await page.getByLabel('รหัสผ่านห้องใหม่').fill(opts.password);
  await page.getByRole('button', { name: 'สร้างห้อง' }).click();
  const code = page.getByTestId('room-code');
  await expect(code).toHaveText(/^[A-Z0-9]{6}$/);
  return (await code.textContent())!.trim();
}

export async function startGame(host: Page) {
  const start = host.getByRole('button', { name: 'เริ่มเกม' });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(host.getByTestId('table')).toBeVisible();
}

export function hand(page: Page) {
  return page.getByTestId('hand').locator('[data-card]');
}

export async function handCards(page: Page): Promise<number[]> {
  return (await hand(page).evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-card'))))).sort((a, b) => a - b);
}

/** All data-card values on the page that are NOT in the player's own hand or the public pile. */
export async function foreignCards(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-card]')]
      .filter((el) => !el.closest('[data-testid=hand]') && !el.closest('[data-testid=pile]'))
      .map((el) => el.getAttribute('data-card')!),
  );
}

export async function statusText(page: Page): Promise<string> {
  return ((await page.getByTestId('status').textContent({ timeout: 2000 }).catch(() => '')) ?? '').trim();
}

/**
 * Performs one UI action if this page has something to do. Returns true if it acted.
 * Turn: hint (คำใบ้) then ลงไพ่, or ผ่าน when no legal move. Exchange: pick N cards then ให้ไพ่.
 */
export async function step(page: Page): Promise<boolean> {
  const status = await statusText(page);
  if (status.startsWith('ตาคุณ')) {
    const before = await page.getByTestId('status').textContent();
    const handBefore = await hand(page).count();
    const hint = page.getByRole('button', { name: 'คำใบ้' });
    if (!(await hint.isEnabled())) return false;
    await hint.click();
    const play = page.getByRole('button', { name: /^(ลงไพ่|ระเบิด)/ });
    const pass = page.getByRole('button', { name: 'ผ่าน', exact: true });
    let played = false;
    // The hint updates React state synchronously; give it a couple of frames at most.
    let canPlay = false;
    for (let i = 0; i < 4 && !canPlay; i++) {
      canPlay = await play.isEnabled();
      if (!canPlay) await page.waitForTimeout(40);
    }
    if (canPlay) {
      await play.click({ timeout: 2000 });
      played = true;
    } else {
      if (await pass.isEnabled()) await pass.click({ timeout: 2000 });
      else {
        // Turn may have moved on (e.g. state changed under us); re-evaluate next loop.
        const now = await statusText(page);
        if (now.startsWith('ตาคุณ') && (await hand(page).count()) === handBefore && now === before?.trim()) {
          const sel = await hand(page).locator('[aria-pressed=true]').count();
          throw new Error(`Stuck: my turn, hint selected ${sel} cards, play disabled, pass disabled. status="${now}"`);
        }
        return false;
      }
    }
    // Wait until the server acknowledged (hand shrank or status changed).
    await expect
      .poll(async () => (played ? (await hand(page).count()) < handBefore : (await statusText(page)) !== before?.trim()) || !(await statusText(page)).startsWith('ตาคุณ'), {
        timeout: 5000,
      })
      .toBe(true);
    return true;
  }
  const m = status.match(/^เลือกไพ่ (\d+) ใบ/);
  if (m) {
    const n = Number(m[1]);
    const cards = hand(page);
    // Clear any stale selection first.
    const pressed = page.getByTestId('hand').locator('[aria-pressed=true]');
    while ((await pressed.count()) > 0) await pressed.first().click();
    for (let i = 0; i < n; i++) await cards.nth(i).click({ position: { x: 8, y: 20 } });
    const give = page.getByRole('button', { name: /^ให้ไพ่/ });
    await expect(give).toBeEnabled();
    await give.click();
    await expect.poll(async () => (await statusText(page)).startsWith('เลือกไพ่'), { timeout: 5000 }).toBe(false);
    return true;
  }
  return false;
}
