Стартовый набор списков (чтобы первый запуск работал без интернета).

- geosite-*.srs — https://github.com/SagerNet/sing-geosite, ветка rule-set, коммит be94d52ad035da5350a1e5f62515185725034d86 (2026-10-05)
- geoip-ru.srs — https://github.com/SagerNet/sing-geoip, ветка rule-set, коммит 7fe82a879ad2666526730c195b55a6d8d9147908 (2026-09-12)

Приложение само обновляет списки в папке данных пользователя; эти файлы — запасной вариант.
Обновить снимок вручную: npm run fetch:rules
