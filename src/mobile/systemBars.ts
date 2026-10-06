// Значки строки состояния (часы, батарея) — светлые на тёмной теме приложения и тёмные на светлой,
// независимо от того, какая тема включена в самом телефоне.
import { SystemBars, SystemBarsStyle } from '@capacitor/core'

export function setBarsForTheme(dark: boolean): void {
  void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined)
}
