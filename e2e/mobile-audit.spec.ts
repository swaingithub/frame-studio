import { test } from '@playwright/test'
import fs from 'node:fs'

const shots = 'e2e/.mobile'
fs.mkdirSync(shots, { recursive: true })

test('mobile audit screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${shots}/01-welcome.png`, fullPage: true })

  // The first-run coach mounts when the project finishes loading, which can
  // lag the click by seconds — dismiss it wherever it shows up.
  const dismissCoach = async (): Promise<void> => {
    const coach = page.getByRole('dialog', { name: /getting started/i })
    if (await coach.count().catch(() => 0)) {
      await coach.getByRole('button', { name: /skip|got it/i }).click().catch(() => undefined)
      await page.waitForTimeout(200)
    }
  }

  // Try sample project if present
  const sample = page.getByRole('button', { name: /learn with a sample|sample project/i })
  if (await sample.count()) {
    await sample.click()
    await page.waitForSelector('main canvas', { timeout: 15000 }).catch(() => undefined)
    await page.waitForTimeout(3000)
    const coach = page.getByRole('dialog', { name: /getting started/i })
    if (await coach.count().catch(() => 0)) await page.screenshot({ path: `${shots}/01b-coach.png` })
    await dismissCoach()
    await page.screenshot({ path: `${shots}/02-after-sample.png`, fullPage: true })

    // Header + panel toggles
    const libraryBtn = page.getByRole('button', { name: /library/i })
    if (await libraryBtn.count()) {
      await libraryBtn.first().click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${shots}/03-library-drawer.png` })
      await page.keyboard.press('Escape')
      await page.waitForTimeout(300)
    }
    const inspectorBtn = page.getByRole('button', { name: /inspector/i })
    if (await inspectorBtn.count()) {
      await inspectorBtn.first().click()
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${shots}/04-inspector-sheet.png` })
      await page.keyboard.press('Escape')
    }

    // Mobile bottom bar: Edit sheet + Compare hold
    await dismissCoach()
    const editBtn = page.getByRole('button', { name: 'Edit', exact: true })
    if (await editBtn.count()) {
      await editBtn.click()
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${shots}/05-mobile-edit-sheet.png` })
      await page.getByRole('dialog', { name: 'Editing tools' }).getByRole('button', { name: 'Close tools' }).click()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${shots}/06-mobile-bar.png` })
    }
  }
})
