// Просмотр трёх направлений оформления (только `npm run ui`, в программу не входит): ?direction=1|2|3|4
import { useEffect, type ReactElement } from 'react'
import { useApp } from '../../store'
import { D1Calm } from './D1Calm'
import { D2Warm } from './D2Warm'
import { D3Game } from './D3Game'
import { D4Outpost } from './D4Outpost'

export function Directions({ n }: { n: string }): ReactElement | null {
  const init = useApp((s) => s.init)
  const ready = useApp((s) => s.ready)
  useEffect(() => { void init() }, [init])
  if (!ready) return null
  return n === '2' ? <D2Warm /> : n === '3' ? <D3Game /> : n === '4' ? <D4Outpost /> : <D1Calm />
}
