export type MailKind = 'confirm' | 'reset' | 'password-reset' | 'address-changed' | 'signup' | 'passkey-added'

export interface Message {
  kind: MailKind
  subject: string
  text: string
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function mailDate(at: Date): string {
  const time = `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()} at ${time} UTC`
}

export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@')
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  return `${local.length > 1 ? local[0] : ''}…@${domain}`
}

const signOff = (origin: string) => `— Folio, ${origin}`

export function confirmMessage({ email, link, origin }: { email: string; link: string; origin: string }): Message {
  return {
    kind: 'confirm',
    subject: 'Confirm your email address for Folio',
    text: [
      'Hello,',
      `Open this link to confirm ${email} as the email address of your Folio account:`,
      link,
      'It works for 24 hours, and only while you’re signed in to the account that asked. Until then Folio won’t use ' +
        'this address. If you didn’t ask for this, ignore this email.',
      signOff(origin),
    ].join('\n\n'),
  }
}

export function resetMessage({ username, link, origin }: { username: string; link: string; origin: string }): Message {
  return {
    kind: 'reset',
    subject: 'Reset your Folio password',
    text: [
      `Hello ${username},`,
      `Someone asked to reset the password of the Folio account “${username}”. To choose a new one, open this link:`,
      link,
      'It works once, for 30 minutes. Changing the password signs the account out everywhere. If it wasn’t you, ' +
        'ignore this email: your password stays as it is.',
      signOff(origin),
    ].join('\n\n'),
  }
}

export function passwordResetNotice({ username, at, origin }: { username: string; at: Date; origin: string }): Message {
  return {
    kind: 'password-reset',
    subject: 'Your Folio password was reset',
    text: [
      `Hello ${username},`,
      `The password of the Folio account “${username}” was reset on ${mailDate(at)}, from a link sent to this ` +
        'address. If it wasn’t you, tell the site’s owner.',
      signOff(origin),
    ].join('\n\n'),
  }
}

export function addressChangedNotice({
  username,
  newEmail,
  at,
  origin,
}: {
  username: string
  newEmail: string
  at: Date
  origin: string
}): Message {
  return {
    kind: 'address-changed',
    subject: 'Your Folio email address was changed',
    text: [
      `Hello ${username},`,
      `The email address of the Folio account “${username}” was changed from this address to ${maskEmail(newEmail)} ` +
        `on ${mailDate(at)}. Folio won’t send mail here any more. If it wasn’t you, tell the site’s owner.`,
      signOff(origin),
    ].join('\n\n'),
  }
}

export function passkeyAddedNotice({
  username,
  name,
  at,
  origin,
}: {
  username: string
  name: string
  at: Date
  origin: string
}): Message {
  return {
    kind: 'passkey-added',
    subject: 'A passkey was added to your Folio account',
    text: [
      `Hello ${username},`,
      `A passkey named “${name}” was added to your Folio account “${username}” on ${mailDate(at)}. If this wasn’t ` +
        'you, sign in, remove it under Account → Passkeys, and change your password.',
      signOff(origin),
    ].join('\n\n'),
  }
}

function quotedList(names: readonly string[]): string {
  const quoted = names.map((n) => `“${n}”`)
  return quoted.length < 2 ? (quoted[0] ?? '') : `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`
}

export function signupMessage({
  link,
  origin,
  existing,
}: {
  link: string
  origin: string
  existing: readonly string[]
}): Message {
  const shared =
    existing.length === 0
      ? []
      : [
          `This address already belongs to the Folio ${existing.length === 1 ? 'account' : 'accounts'} ` +
            `${quotedList(existing)}. To get back into ${existing.length === 1 ? 'it' : 'one'}, reset its password: ` +
            `${origin}/forgot-password`,
        ]
  return {
    kind: 'signup',
    subject: 'Finish signing up for Folio',
    text: [
      'Hello,',
      'Someone asked to create a Folio account with this address. To choose a username and password, open this link:',
      link,
      'It works once, for 24 hours. If you didn’t ask for this, ignore this email: no account is made.',
      ...shared,
      signOff(origin),
    ].join('\n\n'),
  }
}
