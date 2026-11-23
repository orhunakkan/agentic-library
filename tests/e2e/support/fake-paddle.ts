import type { Page } from '@playwright/test'

const SCRIPT = `
(() => {
  const paddle = {
    Initialized: false,
    environment: null,
    callback: null,
    Environment: { set: (env) => { paddle.environment = env } },
    Initialize(options) { paddle.Initialized = true; paddle.callback = options.eventCallback ?? null },
    Update(options) { if (options.eventCallback) paddle.callback = options.eventCallback },
    Checkout: {
      open(options) {
        window.__paddleOpened = { ...options, environment: paddle.environment }
        if (window.__paddleClose) {
          setTimeout(() => paddle.callback?.({ name: 'checkout.closed', data: null }), 50)
          return
        }
        fetch('/test-paddle/complete/' + options.transactionId, { method: 'POST' }).then((response) => {
          if (response.ok) paddle.callback?.({ name: 'checkout.completed', data: { transaction_id: options.transactionId } })
        })
      },
    },
  }
  window.Paddle = paddle
  window.PaddleBillingV1 = paddle
})()
`

export async function fakePaddle(page: Page): Promise<void> {
  await page.route('https://cdn.paddle.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: SCRIPT }),
  )
}
