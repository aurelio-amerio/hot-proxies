import { useEffect, useMemo, useState } from 'react'
import Autocomplete from '@mui/material/Autocomplete'
import TextField from '@mui/material/TextField'
import { createMatcher, type Matcher } from '../data/fuzzy'

export interface SearchBoxProps { loadNames(): Promise<string[]>; onPick(exactName: string): void; disabled?: boolean; label?: string; placeholder?: string }

export function SearchBox({ loadNames, onPick, disabled, label = 'Card name', placeholder = 'Lightning Bolt' }: SearchBoxProps) {
  const [matcher, setMatcher] = useState<Matcher | null>(null)
  const [input, setInput] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => { let on = true; loadNames().then((n) => { if (on) setMatcher(createMatcher(n)) }).catch(() => {}); return () => { on = false } }, [loadNames])
  useEffect(() => { const t = setTimeout(() => setDebounced(input), 100); return () => clearTimeout(t) }, [input])
  const options = useMemo(() => (matcher ? matcher.search(debounced, 8) : []), [matcher, debounced])
  return (
    <Autocomplete
      freeSolo disabled={disabled} options={options} inputValue={input} filterOptions={(x) => x}
      onInputChange={(_e, v) => setInput(v)}
      onChange={(_e, v) => { if (typeof v === 'string' && v.trim()) onPick(v.trim()) }}
      renderInput={(params) => <TextField {...params} label={label} placeholder={placeholder} autoFocus />}
    />
  )
}
