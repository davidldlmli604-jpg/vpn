// Сборка установщика для Windows (.exe). Название и идентификатор берутся из brand.json — в одном месте.
// Запуск на Windows:  npm run dist     (скачает движок, соберёт программу и положит установщик в папку release)
const brand = require('./brand.json')

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: brand.appId,
  productName: brand.name,
  copyright: `© ${new Date().getFullYear()} ${brand.name}`,
  directories: { output: 'release', buildResources: 'resources' },
  // в программу кладём только собранное; исходники и тесты не нужны
  // node_modules не берём: и окно (Vite), и основная часть (esbuild) уже собраны в один файл вместе со своими библиотеками
  files: ['dist/**/*', 'dist-electron/**/*', 'package.json', 'brand.json', '!**/node_modules/**'],
  asar: true,
  // всё, что должно лежать РЯДОМ с программой (а не внутри архива asar): движок, списки правил, значки
  extraResources: [
    { from: 'bin/win32-x64/sing-box.exe', to: 'engine/sing-box.exe' },
    { from: 'bin/win32-x64/LICENSE', to: 'engine/LICENSE-sing-box.txt' },
    { from: 'resources/rules', to: 'rules' },
    { from: 'resources/tray', to: 'tray' },
    { from: 'resources/icon.png', to: 'icon.png' },
    { from: 'THIRD-PARTY-NOTICES.md', to: 'THIRD-PARTY-NOTICES.md' }
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'resources/icon.ico',
    // имя для всех видов, кроме установщика (например, переносимого zip: распаковал папку и запустил — собирается и без Windows)
    artifactName: `${brand.id}-portable-\${version}-win-x64.\${ext}`,
    // обычное окно программы; права администратора понадобятся только режиму «Весь компьютер» (спрашивается отдельно, один раз)
    requestedExecutionLevel: 'asInvoker'
  },
  nsis: {
    oneClick: true, // «нажал — установилось»: без мастера на десять экранов
    perMachine: false, // ставится для текущего пользователя, администратор не нужен
    allowToChangeInstallationDirectory: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: brand.name,
    deleteAppDataOnUninstall: false, // ключи и настройки при удалении программы не пропадают
    installerIcon: 'resources/icon.ico',
    uninstallerIcon: 'resources/icon.ico',
    installerLanguages: ['ru_RU'],
    language: '1049',
    artifactName: `${brand.id}-setup-\${version}.exe`
  },

  // отдельной подписи кода у проекта нет — Windows при первом запуске может показать «неизвестный издатель» (см. ОТЧЁТ.md)
  publish: null
}
