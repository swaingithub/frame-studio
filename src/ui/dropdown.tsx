import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import { cn } from '../lib/cn'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'

export const Dropdown = DropdownPrimitive.Root
export const DropdownTrigger = DropdownPrimitive.Trigger
export const DropdownSub = DropdownPrimitive.Sub

interface DropdownContentProps {
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  className?: string
}

export function DropdownContent({ children, align = 'start', className }: DropdownContentProps): ReactNode {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-50 min-w-48 rounded-lg border border-line bg-elevated p-1 text-sm shadow-xl',
          'focus:outline-none data-[state=open]:fs-anim-menu-in',
          className,
        )}
      >
        {children}
      </DropdownPrimitive.Content>
    </DropdownPrimitive.Portal>
  )
}

export const DropdownItem = DropdownPrimitive.Item

interface MenuItemProps extends ComponentPropsWithoutRef<typeof DropdownPrimitive.Item> {
  icon?: ReactNode
  danger?: boolean
}

const itemClass = cn(
  'flex cursor-default select-none items-center gap-2 rounded-md px-2.5 py-1.5 outline-none',
  'data-[highlighted]:bg-hover data-[disabled]:opacity-40',
)

export function MenuItem({ icon, danger, className, children, ...rest }: MenuItemProps): ReactNode {
  return (
    <DropdownItem
      className={cn(itemClass, danger && 'text-danger data-[highlighted]:bg-danger/10', className)}
      {...rest}
    >
      {icon ? <span className="text-lo shrink-0">{icon}</span> : null}
      {children}
    </DropdownItem>
  )
}

export function MenuLabel({ children }: { children: ReactNode }): ReactNode {
  return (
    <DropdownPrimitive.Label className="px-2.5 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-lo">
      {children}
    </DropdownPrimitive.Label>
  )
}

export function MenuSeparator(): ReactNode {
  return <DropdownPrimitive.Separator className="my-1 h-px bg-line" />
}
