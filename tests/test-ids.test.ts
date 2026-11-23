/**
 * The shared primitives require their test ids in their types, so leaving one out
 * fails `pnpm typecheck`. Each @ts-expect-error below fails the check if that requirement is ever made optional.
 */

import type { ComponentProps } from 'react'
import { describe, expectTypeOf, it } from 'vitest'
import type { AppLink } from '~/client/components/AppLink'
import type { LegalPage } from '~/client/components/LegalPage'
import type { AccountPage, Button, Notice, TextField } from '~/client/features/account/ui'

describe('shared primitives and data-testid', () => {
  it('requires one on Button, AppLink and Notice', () => {
    // @ts-expect-error a Button without data-testid
    const button: ComponentProps<typeof Button> = { children: 'Save' }
    // @ts-expect-error an AppLink without data-testid
    const link: ComponentProps<typeof AppLink> = { href: '/library' }
    // @ts-expect-error a Notice without data-testid
    const notice: ComponentProps<typeof Notice> = { kind: 'error', children: 'Failed' }
    expectTypeOf(button).toHaveProperty('data-testid').toEqualTypeOf<string>()
    expectTypeOf(link).toHaveProperty('data-testid').toEqualTypeOf<string>()
    expectTypeOf(notice).toHaveProperty('data-testid').toEqualTypeOf<string>()
  })

  it("requires the h1's id on the page frames", () => {
    // @ts-expect-error an AccountPage without its title's id
    const account: ComponentProps<typeof AccountPage> = { eyebrow: 'Account', title: 'Account', children: null }
    // @ts-expect-error a LegalPage without its title's id
    const legal: ComponentProps<typeof LegalPage> = { title: 'Terms', lead: '', updated: '2026-11-19', children: null }
    expectTypeOf(account).toHaveProperty('titleTestId').toEqualTypeOf<string>()
    expectTypeOf(legal).toHaveProperty('titleTestId').toEqualTypeOf<string>()
  })

  it('lets a TextField default its id to its name', () => {
    const field: ComponentProps<typeof TextField> = { label: 'Email', name: 'email' }
    expectTypeOf(field).toHaveProperty('data-testid').toEqualTypeOf<string | undefined>()
  })
})
