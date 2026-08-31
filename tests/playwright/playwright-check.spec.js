import fs from 'fs'
import { test, expect } from '@playwright/test'

test('headless smoke - app.html', async ({ page }) => {
  const url = process.env.URL || 'http://localhost:5173/app.html'
  const consoleMsgs = []
  page.on('console', msg => consoleMsgs.push({ type: msg.type(), text: msg.text() }))
  const failedRequests = []
  page.on('requestfailed', req => failedRequests.push({ url: req.url(), method: req.method(), failure: req.failure() }))

  await page.goto(url, { waitUntil: 'networkidle' })

  await expect(page.locator('h1')).toHaveText('Pedidos del día', { timeout: 5000 })
  await expect(page.locator('table')).toBeVisible()
  await expect(page.locator('#orderCards')).toBeVisible()

  if (!fs.existsSync('test-results')) fs.mkdirSync('test-results')
  await page.screenshot({ path: 'test-results/playwright-screenshot.png', fullPage: true })
  fs.writeFileSync('test-results/playwright-console.json', JSON.stringify({ consoleMsgs, failedRequests }, null, 2))
})
