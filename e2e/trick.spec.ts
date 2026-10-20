import { expect, test } from '@playwright/test';
import { createRoom, newGuest, startGame, step } from './helpers';

test('the pile stacks every play in the trick and clears when a new pile starts', async ({ browser }) => {
  const page = await newGuest(browser);
  await createRoom(page, { name: 'Stacker' });
  await startGame(page);
  const plays = page.getByTestId('trick-play');

  let maxSeen = 0;
  let prev = 0;
  let clearedAfterStack = false;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && !(maxSeen >= 2 && clearedAfterStack)) {
    const n = await plays.count();
    if (n > maxSeen) maxSeen = n;
    // Bots lead a new pile within milliseconds, so a clear shows up as the stack getting shorter.
    if (prev >= 2 && n < prev && (await page.getByTestId('round-summary').count()) === 0) clearedAfterStack = true;
    prev = n;
    if ((await page.getByTestId('round-summary').count()) > 0) break;
    await step(page);
    await page.waitForTimeout(100);
  }
  expect(maxSeen).toBeGreaterThanOrEqual(2);
  expect(clearedAfterStack).toBe(true);
});

test('an unplayable selection explains why the play button is disabled', async ({ browser }) => {
  const page = await newGuest(browser);
  await createRoom(page, { name: 'Reasoner' });
  await startGame(page);
  const status = page.getByTestId('status');
  const reason = page.getByTestId('play-reason');

  // Play until it is our turn on a non-empty pile, then pick our weakest card.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const s = await status.textContent();
    if (s?.startsWith('ตาคุณ') && (await page.getByTestId('trick-play').count()) > 0) break;
    if (s?.startsWith('ตาคุณ')) await step(page);
    await page.waitForTimeout(150);
  }
  const weakest = page.getByTestId('hand').locator('[data-card]').first();
  await weakest.click();
  const play = page.getByRole('button', { name: /^(ลงไพ่|ระเบิด)/ });
  if (await play.isDisabled()) {
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText(/ต้องลง|ตองตัดคู่ไม่ได้|โฟร์ตัดเดี่ยวไม่ได้|ไม่ใช่ชุด/);
  } else {
    // The weakest card happened to beat the pile: no reason is shown.
    await expect(reason).toHaveCount(0);
  }
});
