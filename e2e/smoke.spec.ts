import { expect, test } from '@playwright/test'

test('app boots: editor shell and privacy footer render', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Frame Studio/i)
  // Workspace tabs only appear once a project is open — the welcome screen
  // must not show a disabled ghost of them.
  await expect(page.getByRole('button', { name: 'photo editor' })).toHaveCount(0)
  await expect(page.getByText('Try a sample project')).toBeVisible({ timeout: 10_000 })
  await page.getByRole('button', { name: /Try a sample project/ }).click()
  await expect(page.getByRole('button', { name: 'photo editor' })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'video editor' })).toBeVisible()
})

test('CSP meta is present and blocks nothing the shell needs', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto('/')
  const csp = page.locator('meta[http-equiv="Content-Security-Policy"]')
  await expect(csp).toHaveAttribute('content', /script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'/)
  await page.waitForTimeout(2_000)
  // CSP violations surface as page errors (blocked script) — none expected.
  expect(errors).toEqual([])
})

test('nothing leaves the device: only opt-in cross-origin connections', async ({ page }) => {
  const crossOrigin: string[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (url.origin !== 'http://localhost:5173' && !url.protocol.startsWith('blob')) {
      crossOrigin.push(url.host)
    }
  })
  await page.goto('/')
  await page.waitForTimeout(3_000)
  const allowed = ['cdn.jsdelivr.net', 'huggingface.co', 'cdn-lfs.huggingface.co']
  const violators = crossOrigin.filter((host) => !allowed.some((a) => host === a || host.endsWith(`.${a}`)))
  expect(violators).toEqual([])
})
