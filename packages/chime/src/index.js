// Host half of @eeyzs1/dsh-chime — pure client plugin, so the host entry is a
// no-op. Its only job is to make this package a valid loader entry so the
// client-modules service discovers the `dsh.client` declaration.
export const name = '@eeyzs1/dsh-chime'
export const inject = []
export function apply() {}
