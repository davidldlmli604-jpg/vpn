// Проверка ссылок внутри конфига: то, что `sing-box check` не замечает и что вылезло бы только при запуске.
type J = Record<string, any>

export function validateReferences(cfg: J): string[] {
  const problems: string[] = []
  const outbounds: J[] = [...(cfg.outbounds ?? []), ...(cfg.endpoints ?? [])]
  const outTags = new Set<string>()
  for (const o of outbounds) {
    if (!o.tag) problems.push(`у исходящего «${o.type}» нет tag`)
    else if (outTags.has(o.tag)) problems.push(`повторяется tag исходящего «${o.tag}»`)
    outTags.add(o.tag)
  }
  const inTags = new Set<string>()
  for (const i of cfg.inbounds ?? []) {
    if (inTags.has(i.tag)) problems.push(`повторяется tag входящего «${i.tag}»`)
    inTags.add(i.tag)
  }
  const dnsTags = new Set<string>((cfg.dns?.servers ?? []).map((s: J) => s.tag))
  const setTags = new Set<string>((cfg.route?.rule_set ?? []).map((s: J) => s.tag))

  for (const o of outbounds) {
    if (o.detour && !outTags.has(o.detour)) problems.push(`detour «${o.detour}» у «${o.tag}» не существует`)
    if (typeof o.domain_resolver === 'string' && !dnsTags.has(o.domain_resolver)) problems.push(`domain_resolver «${o.domain_resolver}» не существует`)
  }
  for (const s of cfg.dns?.servers ?? []) {
    if (s.detour && !outTags.has(s.detour)) problems.push(`у DNS-сервера «${s.tag}» detour «${s.detour}» не существует`)
    if (typeof s.domain_resolver === 'string' && !dnsTags.has(s.domain_resolver)) problems.push(`у DNS-сервера «${s.tag}» domain_resolver «${s.domain_resolver}» не существует`)
  }
  for (const r of cfg.dns?.rules ?? []) {
    if (r.server && !dnsTags.has(r.server)) problems.push(`DNS-правило ссылается на несуществующий сервер «${r.server}»`)
    for (const t of r.rule_set ?? []) if (!setTags.has(t)) problems.push(`DNS-правило ссылается на несуществующий набор «${t}»`)
  }
  if (cfg.dns?.final && !dnsTags.has(cfg.dns.final)) problems.push(`dns.final «${cfg.dns.final}» не существует`)
  for (const r of cfg.route?.rules ?? []) {
    if (r.action === 'route' && !outTags.has(r.outbound)) problems.push(`маршрут ведёт в несуществующий выход «${r.outbound}»`)
    for (const t of r.rule_set ?? []) if (!setTags.has(t)) problems.push(`маршрут ссылается на несуществующий набор правил «${t}»`)
    for (const t of r.inbound ?? []) if (!inTags.has(t)) problems.push(`маршрут ссылается на несуществующий вход «${t}»`)
  }
  if (cfg.route?.final && !outTags.has(cfg.route.final)) problems.push(`route.final «${cfg.route.final}» не существует`)
  const dr = cfg.route?.default_domain_resolver
  if (typeof dr === 'string' && !dnsTags.has(dr)) problems.push(`default_domain_resolver «${dr}» не существует`)
  // наборы правил, которые объявлены, но нигде не используются, — лишний груз
  const used = new Set<string>()
  for (const r of [...(cfg.route?.rules ?? []), ...(cfg.dns?.rules ?? [])]) for (const t of r.rule_set ?? []) used.add(t)
  for (const t of setTags) if (!used.has(t)) problems.push(`набор правил «${t}» объявлен, но не используется`)
  return problems
}
