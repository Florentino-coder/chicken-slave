import { expect, test } from '@playwright/test';
import { createRoom, handCards, newGuest, setHomeName, startGame } from './helpers';

test('quick play fills the table with 3 bots after QUICK_WAIT_MS', async ({ browser }) => {
  const page = await newGuest(browser);
  await setHomeName(page, 'Quicky');
  await page.getByRole('button', { name: 'เล่นด่วน' }).click();
  await expect(page.getByText(/กำลังหาผู้เล่น/)).toBeVisible();
  await expect(page.getByTestId('table')).toBeVisible({ timeout: 15_000 });
  await expect(page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  const opponents = page.getByTestId('opponent');
  await expect(opponents).toHaveCount(3);
  for (const o of await opponents.all()) await expect(o.getByRole('img', { name: 'บอท' })).toBeVisible();
  await expect(page.getByTestId('hand').locator('[data-card]')).toHaveCount(13);
});

test('reload during a game returns to the same seat with the same hand', async ({ browser }) => {
  const page = await newGuest(browser);
  await createRoom(page, { name: 'Reloader' });
  await startGame(page);
  const hand = page.getByTestId('hand').locator('[data-card]');
  await expect(hand).toHaveCount(13);
  // Wait until it is our turn (bots act in BOT_DELAY_MS) so our hand cannot change underneath us.
  await expect(page.getByTestId('status')).toHaveText(/^ตาคุณ/, { timeout: 20_000 });
  const before = await handCards(page);
  const opponentsBefore = await page.getByTestId('opponent').locator('p.truncate').allTextContents();
  const url = page.url();

  await page.reload();
  await expect(page.getByTestId('table')).toBeVisible();
  expect(page.url()).toBe(url);
  await expect(page.getByTestId('hand').locator('[data-card]')).toHaveCount(before.length);
  expect(await handCards(page)).toEqual(before);
  // Same seat: opponents appear in the same clockwise order, nobody shows as disconnected.
  expect(await page.getByTestId('opponent').locator('p.truncate').allTextContents()).toEqual(opponentsBefore);
  await expect(page.getByTestId('status')).toHaveText(/^ตาคุณ/);
  await expect(page.getByTestId('opponent').filter({ hasText: 'หลุด' })).toHaveCount(0);
});

test('joining with a wrong room code shows an error toast', async ({ browser }) => {
  const page = await newGuest(browser);
  await page.getByLabel('รหัสห้อง').fill('ZZZZ22');
  await page.getByRole('button', { name: 'เข้าห้อง' }).click();
  await expect(page.getByText('ไม่พบห้อง')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);

  // Too short a code is rejected client-side.
  await page.getByLabel('รหัสห้อง').fill('AB');
  await page.getByRole('button', { name: 'เข้าห้อง' }).click();
  await expect(page.getByText('รหัสห้องต้องมี 6 ตัว')).toBeVisible();
});

test('password room requires the password (home form and invite link)', async ({ browser }) => {
  const host = await newGuest(browser);
  const code = await createRoom(host, { name: 'Locker', password: 'sesame' });
  await expect(host.getByText('ห้องนี้มีรหัสผ่าน')).toBeVisible();

  // Via the home page code form.
  const g = await newGuest(browser);
  await g.getByLabel('รหัสห้อง').fill(code);
  await g.getByRole('button', { name: 'เข้าห้อง' }).click();
  await expect(g.getByText('ห้องนี้ต้องใช้รหัสผ่าน')).toBeVisible();
  await expect(g.getByTestId('room-code')).toHaveCount(0);
  await g.getByLabel('รหัสผ่านห้อง', { exact: true }).fill('wrong');
  await g.getByRole('button', { name: 'เข้าห้อง' }).click();
  await expect(g.getByText('รหัสผ่านไม่ถูกต้อง')).toBeVisible();
  await expect(g.getByTestId('room-code')).toHaveCount(0);
  await g.getByLabel('รหัสผ่านห้อง', { exact: true }).fill('sesame');
  await g.getByRole('button', { name: 'เข้าห้อง' }).click();
  await expect(g.getByTestId('room-code')).toHaveText(code);

  // Via the invite link.
  const h = await (await browser.newContext()).newPage();
  await h.goto(`/r/${code}`);
  await h.getByLabel('ชื่อเล่น').fill('Linker');
  await h.getByRole('button', { name: 'เข้าห้อง' }).click();
  await expect(h.getByText('ห้องนี้ต้องใช้รหัสผ่าน')).toBeVisible();
  await expect(h.getByTestId('room-code')).toHaveCount(0);
  await h.getByLabel('รหัสผ่านห้อง').fill('sesame');
  await h.getByRole('button', { name: 'เข้าห้อง' }).click();
  await expect(h.getByTestId('room-code')).toHaveText(code);
  await expect(host.getByTestId('seat').filter({ hasText: 'Linker' })).toHaveCount(1);
});

test('mobile 375x812: table fits without horizontal scroll and actions are visible', async ({ browser }) => {
  const page = await newGuest(browser, {
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await createRoom(page, { name: 'Mobi' });
  await startGame(page);
  await expect(page.getByTestId('hand').locator('[data-card]')).toHaveCount(13);
  await expect(page.getByTestId('status')).toHaveText(/^ตาคุณ/, { timeout: 20_000 });
  await page.getByRole('button', { name: 'คำใบ้' }).click(); // select something so the play button shows its label

  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  for (const name of ['ผ่าน', 'คำใบ้', 'ล้างที่เลือก']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await expect(page.getByRole('button', { name: /^ลงไพ่/ })).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId('status')).toBeInViewport();
  await expect(page.getByTestId('opponent')).toHaveCount(3);
  for (const o of await page.getByTestId('opponent').all()) await expect(o).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'e2e/screenshots/table-mobile.png' });
});
