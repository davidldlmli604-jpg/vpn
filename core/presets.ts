// Готовые наборы программ, которые удобно пускать мимо VPN.
// Имена процессов sing-box сравнивает точно (с учётом регистра), поэтому в сборщике добавляются варианты.

export interface AppPreset {
  id: string
  title: string
  description: string
  processes: string[]
}

export const GAMES_PRESET: AppPreset = {
  id: 'games',
  title: 'Игры и лаунчеры',
  description: 'Steam, Epic Games, Battle.net, Riot, EA, Ubisoft, GOG, Wargaming, Lesta, VK Play и популярные игры. Так игры не будут «лагать» из-за лишнего круга через VPN.',
  processes: [
    // Steam
    'steam.exe', 'steamwebhelper.exe', 'steamservice.exe', 'steamerrorreporter.exe', 'gameoverlayui.exe',
    // Epic Games
    'EpicGamesLauncher.exe', 'EpicWebHelper.exe', 'EOSOverlayRenderer-Win64-Shipping.exe', 'EasyAntiCheat.exe', 'EasyAntiCheat_EOS.exe',
    // Blizzard
    'Battle.net.exe', 'Agent.exe', 'Overwatch.exe', 'Wow.exe', 'Diablo IV.exe',
    // Riot
    'RiotClientServices.exe', 'RiotClientUx.exe', 'RiotClientUxRender.exe', 'LeagueClient.exe', 'League of Legends.exe', 'VALORANT-Win64-Shipping.exe', 'vgc.exe',
    // EA
    'EADesktop.exe', 'EABackgroundService.exe', 'EALocalHostSvc.exe', 'Origin.exe', 'OriginWebHelperService.exe',
    // Ubisoft
    'UbisoftConnect.exe', 'upc.exe', 'UplayWebCore.exe', 'UbisoftGameLauncher.exe',
    // GOG
    'GalaxyClient.exe', 'GalaxyClient Helper.exe', 'GalaxyCommunication.exe',
    // Wargaming / Lesta / VK Play
    'wgc.exe', 'wgc_api.exe', 'WorldOfTanks.exe', 'WorldOfWarships64.exe', 'lgc.exe', 'lgc_api.exe', 'MirTankov.exe', 'VKPlayGameCenter.exe', 'GameCenter.exe', 'MailRuGameCenter.exe',
    // Популярные игры
    'cs2.exe', 'csgo.exe', 'dota2.exe', 'RustClient.exe', 'GTA5.exe', 'FiveM.exe', 'RocketLeague.exe', 'r5apex.exe', 'Cyberpunk2077.exe',
    'EscapeFromTarkov.exe', 'BsgLauncher.exe', 'TslGame.exe', 'FortniteClient-Win64-Shipping.exe', 'Warframe.x64.exe', 'GenshinImpact.exe', 'YuanShen.exe',
    'BEService.exe', 'BEService_x64.exe'
  ]
}

export const APP_PRESETS: AppPreset[] = [GAMES_PRESET]

/** Для каждого имени добавляем вариант в нижнем регистре: Windows возвращает путь в том виде, как записан на диске. */
export function expandProcessNames(names: string[]): string[] {
  const out = new Set<string>()
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    out.add(name)
    out.add(name.toLowerCase())
  }
  return Array.from(out)
}
