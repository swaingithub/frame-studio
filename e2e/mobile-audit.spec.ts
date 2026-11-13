import { test } from '@playwright/test'
import fs from 'node:fs'

const shots = 'e2e/.mobile'
fs.mkdirSync(shots, { recursive: true })

test('mobile audit screenshots', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${shots}/01-welcome.png`, fullPage: true })

  // Try sample project if present
  const sample = page.getByRole('button', { name: /sample project/i })
  if (await sample.count()) {
    await sample.click()
    await page.waitForSelector('main canvas', { timeout: 15000 }).catch(() => undefined)
    await page.waitForTimeout(3000)
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
  }
})
