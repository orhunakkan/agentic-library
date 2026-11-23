import { DialogTitle } from './ConfirmDialog'
import { ShownOnce } from './PasswordPanel'

export function InviteLinkPanel({ titleId, link, onDone }: { titleId: string; link: string; onDone: () => void }) {
  return (
    <>
      <DialogTitle id={titleId}>Invite link</DialogTitle>
      <ShownOnce
        id="invite-link"
        testId="invite-link"
        label="Invite link"
        value={link}
        textSize="text-[14px]"
        onDone={onDone}
      >
        Send it to them yourself. Folio shows it only now.
      </ShownOnce>
    </>
  )
}
