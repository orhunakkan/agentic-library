export function canUsePasskeys(scope: { PublicKeyCredential?: unknown; navigator?: Navigator } = globalThis): boolean {
  return (
    typeof scope.PublicKeyCredential === 'function' &&
    typeof scope.navigator?.credentials?.create === 'function' &&
    typeof scope.navigator?.credentials?.get === 'function'
  )
}
