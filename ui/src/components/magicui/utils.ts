// Magic UI helper (clsx only; we keep our own tokens instead of tailwind-merge)
import { clsx, type ClassValue } from 'clsx'

export const cn = (...v: ClassValue[]) => clsx(v)
