import { cn } from '../lib/cn'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'subtle' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'icon'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-onaccent hover:brightness-110 active:brightness-95 shadow-[0_1px_2px_rgba(0,0,0,0.25)]',
  ghost: 'text-hi hover:bg-hover',
  outline: 'border border-line text-hi hover:bg-hover',
  subtle: 'bg-elevated text-hi hover:bg-hover border border-line',
  danger: 'text-danger hover:bg-danger/10',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  icon: 'h-8 w-8 p-0 justify-center',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children?: ReactNode
}

/**
 * Forwarding refs keeps Radix `asChild` wrappers (tooltips, popovers) happy —
 * without this, React logs a ref warning for every tooltip'd button.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex shrink-0 select-none items-center rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        'disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    />
  )
})
