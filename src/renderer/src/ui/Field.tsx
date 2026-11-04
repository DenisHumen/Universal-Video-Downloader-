import {
  forwardRef,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes
} from 'react'
import { cx } from './cx'

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 34 px by default, 40 px for `lg`. */
  size?: 'md' | 'lg'
}

/** A text field. Needs a label: a `<label>` around it, `aria-label` or `aria-labelledby`. */
export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { size = 'md', className, ...rest },
  ref
) {
  return <input ref={ref} className={cx('ui-field', size === 'lg' && 'ui-field-lg', className)} {...rest} />
})

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx('ui-field', className)} {...rest} />
  }
)
