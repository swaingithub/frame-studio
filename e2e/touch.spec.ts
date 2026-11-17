import { expect, test } from '@playwright/test'
import fs from 'node:fs'

const shots = 'e2e/.touch'
fs.mkdirSync(shots, { recursive: true })

/**
 * Touch-gesture smoke tests for the CapCut-style timeline (touch devices
 * only, so this runs in the mobile context). Desktop timelines keep the
 * classic drag-to-scrub behavior and are covered by the smoke suite.
 */
test('touch timeline: pan scrubs, contextual toolbar appears', async ({ browser }) => {
  test.setTimeout(90_000)
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  })
  const page = await context.newPage()
  page.on('crash', () => console.log('PAGE CRASHED'))
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message.slice(0, 120)))
  await page.goto('/')
  await page.waitForTimeout(1000)

  const sample = page.getByRole('button', { name: /learn with a sample/i })
  if (await sample.count()) await sample.click()
  // The coach mounts when the project finishes loading (can lag the click),
  // so dismiss it wherever it pops up.
  const dismissCoach = async (): Promise<void> => {
    const coach = page.getByRole('dialog', { name: /getting started/i })
    if (await coach.count().catch(() => 0)) {
      await coach.getByRole('button', { name: /skip|got it/i }).click().catch(() => undefined)
      await page.waitForTimeout(200)
    }
  }
  await dismissCoach()

  // The video workspace: switch to Video, select the sample clip on the track.
  // (Mobile hides the " editor" suffix on the workspace tabs.)
  await page.getByRole('tab', { name: 'video', exact: true }).click().catch(() => undefined)
  await page.waitForTimeout(1500)
  const track = page.locator('[data-sequence-track]')
  if (await track.count()) {
    const box = await track.boundingBox()
    expect(box).not.toBeNull()
    console.log('STEP: track found')

    // Pan the track: touch-drag from the middle of the timeline to the left.
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2)
    await page.waitForTimeout(400)
    console.log('STEP: tapped track')

    // Tap a clip block to select it: the contextual toolbar must appear.
    // (Coordinate tap — the timeline re-renders continuously, so element
    // actionability checks never settle.)
    const clip = page.locator('[data-sequence-track] > [aria-label^="Clip "]').first()
    const clipBox = await clip.boundingBox()
    expect(clipBox).not.toBeNull()
    await page.touchscreen.tap(clipBox!.x + clipBox!.width / 2, clipBox!.y + clipBox!.height / 2)
    await page.waitForTimeout(500)
    console.log('STEP: tapped clip')
    await dismissCoach()
    await expect(page.getByRole('toolbar', { name: 'Clip tools' })).toBeVisible()
    await page.screenshot({ path: `${shots}/02-contextual-toolbar.png` })

    // Done returns to the standard bar. The rail scrolls horizontally, so
    // bring Done into view before tapping.
    await dismissCoach()
    const done = page.getByRole('button', { name: 'Done' })
    await done.evaluate((el) => el.scrollIntoView({ inline: 'center', block: 'nearest' }))
    await page.waitForTimeout(200)
    const doneBox = await done.boundingBox()
    if (doneBox) await page.touchscreen.tap(doneBox.x + doneBox.width / 2, doneBox.y + doneBox.height / 2)
    await page.waitForTimeout(300)
    await expect(page.getByRole('toolbar', { name: 'Clip tools' })).toHaveCount(0)
  }

  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  expect(errors).toEqual([])
  await context.close()
})
