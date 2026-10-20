import { Page, expect, test } from '@playwright/test';
import { THREE_OF_CLUBS, createRoom, foreignCards, handCards, newGuest, startGame, statusText, step } from './helpers';

const NAMES = ['Ann', 'Bob', 'Cat', 'Dan'];

async function assertHandsPrivateAndDisjoint(pages: Page[], expectedTotal?: number) {
  const hands = await Promise.all(pages.map(handCards));
  const all = hands.flat();
  expect(new Set(all).size, `hands overlap: ${JSON.stringify(hands)}`).toBe(all.length);
  if (expectedTotal !== undefined) expect(all.length).toBe(expectedTotal);
  for (const p of pages) expect(await foreignCards(p)).toEqual([]);
  return hands;
}

/** Opponent tile on `viewer` for player `name` shows `n ใบ`. */
function opponentTile(viewer: Page, name: string) {
  return viewer.getByTestId('opponent').filter({ hasText: name });
}

async function opponentCount(viewer: Page, name: string): Promise<number> {
  const t = (await opponentTile(viewer, name).textContent()) ?? '';
  const m = t.match(/(\d+) ใบ/);
  return m ? Number(m[1]) : NaN;
}

test('4 guests: invite link, ready, play round 1 via UI, exchange, round 2 starts', async ({ browser }) => {
  test.setTimeout(240_000);
  const pages: Page[] = [];
  const host = await newGuest(browser);
  pages.push(host);
  const code = await createRoom(host, { name: NAMES[0] });
  const link = await host.getByLabel('ลิงก์ชวนเพื่อน').inputValue();
  expect(link).toMatch(new RegExp(`/r/${code}$`));

  for (let i = 1; i < 4; i++) {
    const p = await (await browser.newContext()).newPage();
    await p.goto(new URL(link).pathname);
    await p.getByLabel('ชื่อเล่น').fill(NAMES[i]);
    await p.getByRole('button', { name: 'เข้าห้อง' }).click();
    await expect(p.getByTestId('room-code')).toHaveText(code);
    pages.push(p);
  }
  // Everyone sees 4 filled seats with the right names.
  for (const p of pages) for (const n of NAMES) await expect(p.getByTestId('seat').filter({ hasText: n })).toHaveCount(1);

  await expect(host.getByRole('button', { name: 'เริ่มเกม' })).toBeDisabled();
  for (const p of pages.slice(1)) await p.getByRole('button', { name: 'พร้อม', exact: true }).click();
  await startGame(host);

  // ---- Initial deal ----
  for (const p of pages) {
    await expect(p.getByTestId('table')).toBeVisible();
    await expect(p.getByTestId('hand').locator('[data-card]')).toHaveCount(13);
    await expect(p.getByTestId('opponent')).toHaveCount(3);
    for (const o of await p.getByTestId('opponent').all()) await expect(o).toContainText('13 ใบ');
  }
  const hands = await assertHandsPrivateAndDisjoint(pages, 52);
  const leaderIdx = hands.findIndex((h) => h.includes(THREE_OF_CLUBS));
  const leader = pages[leaderIdx];
  await expect(leader.getByTestId('status')).toHaveText(/^ตาคุณ/);
  await expect(leader.getByTestId('status')).toContainText('3♣');
  for (const p of pages) if (p !== leader) await expect(p.getByTestId('status')).not.toHaveText(/^ตาคุณ/);

  // ---- First move by the 3♣ holder; opponents' counts update everywhere ----
  expect(await step(leader)).toBe(true);
  const leaderLeft = (await handCards(leader)).length;
  expect(leaderLeft).toBeLessThan(13);
  expect(await handCards(leader)).not.toContain(THREE_OF_CLUBS);
  for (const p of pages) {
    if (p === leader) continue;
    await expect(opponentTile(p, NAMES[leaderIdx])).toContainText(`${leaderLeft} ใบ`);
    await expect(p.getByTestId('pile').locator(`[data-card="${THREE_OF_CLUBS}"]`)).toBeVisible();
  }

  // ---- Play round 1 through the UI ----
  const summarySeen = pages.map((p) => p.getByTestId('round-summary').waitFor({ timeout: 200_000 }));
  let summaryDone = false;
  void Promise.race(summarySeen).then(() => (summaryDone = true));
  let actions = 1;
  let checks = 0;
  const deadline = Date.now() + 200_000;
  while (!summaryDone && Date.now() < deadline) {
    let acted = false;
    for (const p of pages) {
      if (summaryDone) break;
      if (await p.getByTestId('round-summary').isVisible()) continue;
      if (await step(p).catch((e) => (String(e).includes('Stuck') ? Promise.reject(e) : false))) {
        acted = true;
        actions++;
      }
    }
    // Periodically verify privacy and that opponent counts mirror the real hand sizes.
    if (acted && ++checks % 5 === 0) for (const p of pages) expect(await foreignCards(p)).toEqual([]);
    if (!acted) await pages[0].waitForTimeout(50);
  }
  await Promise.all(summarySeen);
  test.info().annotations.push({ type: 'round1-actions', description: String(actions) });

  // Round summary: stable state, counts on opponent tiles match the owners' hands.
  const sizes = await Promise.all(pages.map(async (p) => (await handCards(p)).length));
  expect(sizes.filter((s) => s > 0).length).toBe(1); // only the slave has cards left
  for (let v = 0; v < 4; v++)
    for (let o = 0; o < 4; o++) if (v !== o) expect(await opponentCount(pages[v], NAMES[o])).toBe(sizes[o]);
  for (const p of pages) {
    await expect(p.getByTestId('round-summary')).toContainText('จบรอบที่ 1');
    await expect(p.getByTestId('round-summary').locator('li')).toHaveCount(4);
  }

  // ---- Round 2: exchange then play ----
  for (const p of pages) await expect(p.getByTestId('round-summary')).toBeHidden({ timeout: 10_000 });
  for (const p of pages) await expect(p.getByTestId('table')).toContainText('รอบ 2');
  // King (2 cards) and queen (1 card) must choose cards to return.
  const exchangers: { p: Page; n: number }[] = [];
  await expect
    .poll(async () => {
      exchangers.length = 0;
      for (const p of pages) {
        const m = (await statusText(p)).match(/^เลือกไพ่ (\d+) ใบ/);
        if (m) exchangers.push({ p, n: Number(m[1]) });
      }
      return exchangers.map((e) => e.n).sort();
    })
    .toEqual([1, 2]);
  await assertHandsPrivateAndDisjoint(pages, 52);
  for (const { p } of exchangers) expect(await step(p)).toBe(true);

  // Exchange done: someone's turn in round 2; deal is still a partition of the deck.
  await expect
    .poll(async () => (await Promise.all(pages.map(statusText))).filter((s) => s.startsWith('ตาคุณ')).length, { timeout: 10_000 })
    .toBe(1);
  const r2 = await assertHandsPrivateAndDisjoint(pages, 52);
  for (const h of r2) expect(h.length).toBe(13);
  await host.screenshot({ path: 'e2e/screenshots/table-desktop.png' });

  // Play a couple more moves in round 2 to make sure play continues.
  let more = 0;
  while (more < 3) {
    for (const p of pages) if (await step(p)) more++;
  }
});
