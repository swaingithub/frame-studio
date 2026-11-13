import { cn } from '../lib/cn'
import type { InputHTMLAttributes, ReactNode } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  children?: ReactNode
}

export function Input({ className, ...rest }: InputProps): ReactNode {
  return (
    <input
      className={cn(
        'h-9 w-full rounded-md border border-line bg-elevated px-3 text-sm text-hi',
        'placeholder:text-lo/70 focus:border-accent focus:outline-none',
        className,
      )}
      {...rest}
    />
  )
}
