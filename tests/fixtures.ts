// Образцы ключей для тестов. Все секреты — выдуманные, подключаться по ним некуда.
export const UUID = 'e9a5d2ee-9d2d-4747-8686-86bc19445dc5'
export const REALITY_PRIVATE = 'QHETYslUrRNapxyUUmrB4eEMmhij9nMzralDVeRJkmc'
export const REALITY_PUBLIC = '3O42VkE_Tje1GYx65_iTq5jYWkBSPjQC55ovZ2ZaxiI'
export const SS2022_KEY = 'QOypW5nzflt+yREFCQ3myFq+qJWT7LpV94GOF6f9M6s='

const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')
const b64url = (s: string): string => b64(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const vmessJson = (over: Record<string, unknown> = {}): string =>
  'vmess://' +
  b64(
    JSON.stringify({ v: '2', ps: '🇩🇪 Германия | vmess', add: 'de.example.com', port: '443', id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: 'cdn.example.com', path: '/ws?ed=2048', tls: 'tls', sni: 'cdn.example.com', alpn: 'h2,http/1.1', fp: 'chrome', ...over })
  )

export const GOOD: Record<string, string> = {
  vlessReality: `vless://${UUID}@nl.example.com:443?encryption=none&flow=xtls-rprx-vision&security=reality&sni=www.microsoft.com&fp=chrome&pbk=${REALITY_PUBLIC}&sid=6ba85179e30d4fc2&type=tcp&headerType=none#%F0%9F%87%B3%F0%9F%87%B1%20Нидерланды%20Reality`,
  vlessWs: `vless://${UUID}@cdn.example.com:443?encryption=none&security=tls&sni=cdn.example.com&fp=firefox&alpn=h2%2Chttp%2F1.1&type=ws&host=cdn.example.com&path=%2Fvless%3Fed%3D2560#WS-TLS`,
  vlessGrpc: `vless://${UUID}@fi.example.com:443?encryption=none&security=tls&sni=fi.example.com&type=grpc&serviceName=grpcsvc&mode=gun#Finland%20gRPC`,
  vlessPlain: `vless://${UUID}@10.0.0.5:8443?encryption=none&type=tcp#Plain`,
  vlessHttpUpgrade: `vless://${UUID}@hu.example.com:443?security=tls&sni=hu.example.com&type=httpupgrade&path=%2Fup&host=hu.example.com#HU`,
  vmess: vmessJson(),
  vmessTcp: vmessJson({ net: 'tcp', tls: '', path: '', host: '', ps: 'Plain vmess' }),
  vmessGrpc: vmessJson({ net: 'grpc', path: 'svc', host: '', ps: 'gRPC' }),
  vmessUrl: `vmess://${UUID}@us.example.com:443?encryption=auto&security=tls&type=ws&host=us.example.com&path=%2F#US%20vmess`,
  trojan: 'trojan://p%40ss%3Aw0rd@tr.example.com:443?security=tls&sni=tr.example.com&type=tcp&alpn=h2#Trojan%20TR',
  trojanWs: 'trojan://secret@ws.example.com:443?sni=ws.example.com&type=ws&path=%2Ftrojan&host=ws.example.com#TrojanWS',
  ssSip002: `ss://${b64url('aes-256-gcm:pass-word')}@sw.example.com:8388#%D0%A8%D0%B2%D0%B5%D1%86%D0%B8%D1%8F%20SS`,
  ssLegacy: `ss://${b64('chacha20-ietf-poly1305:legacy-pass@legacy.example.com:8388')}#Legacy`,
  ss2022: `ss://2022-blake3-aes-256-gcm:${encodeURIComponent(SS2022_KEY)}@ss22.example.com:8388#SS2022`,
  ssPlugin: `ss://${b64url('aes-128-gcm:obfs-pass')}@obfs.example.com:443/?plugin=${encodeURIComponent('obfs-local;obfs=tls;obfs-host=www.bing.com')}#Obfs`,
  hysteria2: 'hysteria2://hy2pass@hy.example.com:443?sni=hy.example.com&insecure=0&obfs=salamander&obfs-password=obfspw&alpn=h3#Hy2',
  hy2Short: 'hy2://hy2pass@hy2.example.com:8443?insecure=1&sni=hy2.example.com#Hy2%20Short',
  hy2Hop: 'hysteria2://hy2pass@hop.example.com:443?mport=20000-30000&sni=hop.example.com#Hop',
  tuic: `tuic://${UUID}:tuicpass@tu.example.com:443?congestion_control=bbr&udp_relay_mode=native&alpn=h3&sni=tu.example.com&allow_insecure=0#TUIC`,
  anytls: 'anytls://anypass@any.example.com:443?sni=any.example.com&insecure=0#AnyTLS'
}

export const BROKEN: Array<{ name: string; input: string; code: string }> = [
  { name: 'пусто', input: '', code: 'empty' },
  { name: 'пробелы', input: '   \n  ', code: 'empty' },
  { name: 'просто текст', input: 'привет, это не ключ', code: 'not-a-key' },
  { name: 'vless без адреса', input: `vless://${UUID}@:443?security=none`, code: 'missing-host' },
  { name: 'vless без порта', input: `vless://${UUID}@example.com?security=none`, code: 'missing-port' },
  { name: 'vless порт-мусор', input: `vless://${UUID}@example.com:abc?security=none`, code: 'bad-port' },
  { name: 'vless порт 70000', input: `vless://${UUID}@example.com:70000`, code: 'bad-port' },
  { name: 'vless без uuid', input: 'vless://@example.com:443?security=none', code: 'missing-secret' },
  { name: 'vless кривой uuid', input: 'vless://not-a-uuid@example.com:443', code: 'bad-secret' },
  { name: 'vless reality без pbk', input: `vless://${UUID}@example.com:443?security=reality&sni=a.com`, code: 'missing-secret' },
  { name: 'vless reality кривой pbk', input: `vless://${UUID}@example.com:443?security=reality&sni=a.com&pbk=short`, code: 'bad-secret' },
  { name: 'vless xhttp', input: `vless://${UUID}@example.com:443?security=tls&type=xhttp`, code: 'unsupported-transport' },
  { name: 'vless mkcp', input: `vless://${UUID}@example.com:443?type=kcp`, code: 'unsupported-transport' },
  { name: 'vless новое шифрование', input: `vless://${UUID}@example.com:443?encryption=mlkem768x25519plus.native.0rtt.abc`, code: 'unsupported-feature' },
  { name: 'vmess не base64', input: 'vmess://%%%не-base64%%%', code: 'bad-encoding' },
  { name: 'vmess base64 не json', input: 'vmess://' + Buffer.from('просто текст').toString('base64'), code: 'bad-json' },
  { name: 'vmess битый json', input: 'vmess://' + Buffer.from('{"add":"a.com","port":').toString('base64'), code: 'bad-json' },
  { name: 'vmess без адреса', input: vmessJson({ add: '' }), code: 'missing-host' },
  { name: 'vmess без uuid', input: vmessJson({ id: '' }), code: 'missing-secret' },
  { name: 'vmess порт ноль', input: vmessJson({ port: '0' }), code: 'bad-port' },
  { name: 'vmess странный шифр', input: vmessJson({ scy: 'rot13' }), code: 'unsupported-cipher' },
  { name: 'trojan без пароля', input: 'trojan://@example.com:443', code: 'missing-secret' },
  { name: 'trojan без порта', input: 'trojan://pass@example.com', code: 'missing-port' },
  { name: 'ss мусор вместо base64', input: 'ss://***@example.com:8388', code: 'bad-encoding' },
  { name: 'ss неизвестный шифр', input: `ss://${Buffer.from('rot13:pass').toString('base64')}@example.com:8388`, code: 'unsupported-cipher' },
  { name: 'ss без пароля', input: `ss://${Buffer.from('aes-256-gcm:').toString('base64')}@example.com:8388`, code: 'missing-secret' },
  { name: 'ss без порта', input: `ss://${Buffer.from('aes-256-gcm:pw').toString('base64')}@example.com`, code: 'missing-port' },
  { name: 'ss чужой плагин', input: `ss://${Buffer.from('aes-256-gcm:pw').toString('base64')}@example.com:8388/?plugin=kcptun%3Bkey%3D1`, code: 'unsupported-feature' },
  { name: 'ss legacy без @', input: 'ss://' + Buffer.from('aes-256-gcm:pw').toString('base64'), code: 'broken' },
  { name: 'hy2 без пароля', input: 'hysteria2://@example.com:443', code: 'missing-secret' },
  { name: 'hy2 без порта', input: 'hysteria2://pw@example.com', code: 'missing-port' },
  { name: 'hy2 чужой obfs', input: 'hysteria2://pw@example.com:443?obfs=xor&obfs-password=1', code: 'unsupported-feature' },
  { name: 'hy2 obfs без пароля', input: 'hysteria2://pw@example.com:443?obfs=salamander', code: 'missing-secret' },
  { name: 'hy2 кривые порты', input: 'hysteria2://pw@example.com:443?mport=900-100', code: 'bad-port' },
  { name: 'tuic без пароля', input: `tuic://${UUID}@example.com:443`, code: 'missing-secret' },
  { name: 'tuic кривой uuid', input: 'tuic://zzz:pw@example.com:443', code: 'bad-secret' },
  { name: 'tuic странный congestion', input: `tuic://${UUID}:pw@example.com:443?congestion_control=magic`, code: 'unsupported-feature' },
  { name: 'anytls без пароля', input: 'anytls://@example.com:443', code: 'missing-secret' },
  { name: 'ssr', input: 'ssr://c29tZXRoaW5n', code: 'unsupported-protocol' },
  { name: 'wireguard', input: 'wireguard://abc@example.com:51820', code: 'unsupported-protocol' },
  { name: 'ipv6 скобка не закрыта', input: `vless://${UUID}@[2001:db8::1:443`, code: 'broken' },
  { name: 'json с ошибкой', input: '{"outbounds": [', code: 'bad-json' },
  { name: 'json без outbounds', input: '{"log": {}}', code: 'no-servers' }
]
